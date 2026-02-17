const authConfig = window.VYBE_AUTH_CONFIG || {};
const supabaseFactory = window.supabase;
const supabasePublicKey =
  authConfig.supabaseAnonKey || authConfig.supabasePublishableKey || "";
window.__uploadScriptLoaded = true;

const uploadForm = document.getElementById("asset-upload-form");
const uploadStatus = document.getElementById("upload-status");
const uploadGateStatus = document.getElementById("upload-gate-status");
const uploadSubmitBtn = document.getElementById("upload-submit-btn");
const uploadOverlay = document.getElementById("upload-overlay");
const uploadOverlayText = document.getElementById("upload-overlay-text");
const uploadProgressBar = document.getElementById("upload-progress-bar");
const uploadProgressPct = document.getElementById("upload-progress-pct");

let supabaseClient = null;
let currentSession = null;
let uploadReady = false;

const redirectToAssets = () => {
  window.location.replace("assets.html");
};

const withTimeout = async (promise, timeoutMs, label) => {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
  }
};

const toSlug = (value) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

const getTagsFromText = (text) => {
  return [...new Set(
    String(text || "")
      .split(",")
      .map((tag) => tag.trim().toLowerCase())
      .filter(Boolean)
  )];
};

const setOverlay = (percent, text) => {
  if (uploadProgressBar) {
    uploadProgressBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  }
  if (uploadProgressPct) {
    uploadProgressPct.textContent = `${Math.round(percent)}%`;
  }
  if (uploadOverlayText) {
    uploadOverlayText.textContent = text;
  }
};

const openOverlay = () => {
  if (uploadOverlay) {
    uploadOverlay.classList.remove("hidden");
  }
  document.body.classList.add("uploading");
};

const closeOverlay = () => {
  if (uploadOverlay) {
    uploadOverlay.classList.add("hidden");
  }
  document.body.classList.remove("uploading");
};

const checkAdminAccess = async (userId) => {
  if (!userId || !supabaseClient) {
    return false;
  }
  const configuredAdminId =
    typeof authConfig.adminUserId === "string" ? authConfig.adminUserId.trim() : "";
  if (configuredAdminId && configuredAdminId === userId) {
    return true;
  }
  try {
    const { data, error } = await withTimeout(
      supabaseClient
        .from("site_admins")
        .select("user_id")
        .eq("user_id", userId)
        .maybeSingle(),
      12000,
      "admin check"
    );
    if (error) {
      return false;
    }
    return Boolean(data?.user_id);
  } catch (_err) {
    return false;
  }
};

const handleUploadSubmit = async (event) => {
  event.preventDefault();
  if (!uploadReady || !supabaseClient || !currentSession?.user?.id) {
    uploadStatus.textContent = "Upload is not ready yet.";
    return;
  }

  const title = document.getElementById("upload-title")?.value?.trim();
  const description = document.getElementById("upload-description")?.value?.trim() || null;
  const requiredTier = document.getElementById("upload-tier")?.value || "creator";
  const tagsText = document.getElementById("upload-tags")?.value || "";
  const uploadFileInput = document.getElementById("upload-file");
  const file = uploadFileInput?.files?.[0];

  if (!title || !file) {
    uploadStatus.textContent = "Title and file are required.";
    return;
  }

  const ext = file.name.includes(".") ? file.name.slice(file.name.lastIndexOf(".")).toLowerCase() : "";
  const slugBase = toSlug(title) || `asset-${Date.now()}`;
  const slug = `${slugBase}-${Date.now()}`;
  const objectPath = `${slug}${ext}`;
  const tags = getTagsFromText(tagsText);

  uploadSubmitBtn.disabled = true;
  uploadStatus.textContent = "";
  openOverlay();
  setOverlay(4, "Preparing upload...");

  let progress = 4;
  const progressTimer = setInterval(() => {
    progress = Math.min(progress + Math.random() * 6, 82);
    setOverlay(progress, "Uploading file...");
  }, 220);

  try {
    const uploadResult = await supabaseClient.storage
      .from("asset-files")
      .upload(objectPath, file, { upsert: false });

    clearInterval(progressTimer);
    if (uploadResult.error) {
      throw new Error(uploadResult.error.message);
    }

    setOverlay(88, "Saving asset record...");
    const insertResult = await supabaseClient
      .from("assets")
      .insert({
        slug,
        title,
        description,
        required_tier: requiredTier,
        tags,
        storage_object_path: objectPath,
        is_published: true
      });

    if (insertResult.error) {
      throw new Error(insertResult.error.message);
    }

    setOverlay(100, "Uploaded");
    uploadStatus.textContent = "Asset uploaded successfully.";
    uploadForm.reset();

    setTimeout(() => {
      closeOverlay();
      uploadSubmitBtn.disabled = false;
      uploadStatus.textContent = "";
    }, 1500);
  } catch (error) {
    clearInterval(progressTimer);
    setOverlay(100, "Upload failed");
    uploadStatus.textContent = `Upload failed: ${error.message}`;
    setTimeout(() => {
      closeOverlay();
      uploadSubmitBtn.disabled = false;
    }, 900);
  }
};

const initUploadPage = async () => {
  if (uploadForm) {
    uploadForm.addEventListener("submit", handleUploadSubmit);
  }

  const canInitAuth =
    typeof supabaseFactory?.createClient === "function" &&
    typeof authConfig.supabaseUrl === "string" &&
    authConfig.supabaseUrl.includes("supabase.co") &&
    typeof supabasePublicKey === "string" &&
    supabasePublicKey.length > 20;

  if (!canInitAuth) {
    redirectToAssets();
    return;
  }

  supabaseClient = supabaseFactory.createClient(
    authConfig.supabaseUrl,
    supabasePublicKey,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    }
  );

  try {
    const { data } = await withTimeout(
      supabaseClient.auth.getSession(),
      16000,
      "getSession"
    );
    currentSession = data?.session || null;
  } catch (_error) {
    redirectToAssets();
    return;
  }

  if (!currentSession?.user?.id) {
    redirectToAssets();
    return;
  }

  const isAdmin = await checkAdminAccess(currentSession.user.id);
  if (!isAdmin) {
    redirectToAssets();
    return;
  }

  uploadReady = true;
  if (uploadGateStatus) {
    uploadGateStatus.textContent = "Admin verified. Ready to upload.";
  }
  if (uploadForm) {
    uploadForm.hidden = false;
  }
};

initUploadPage();
