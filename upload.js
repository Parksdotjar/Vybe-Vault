const authConfig = window.VYBE_AUTH_CONFIG || {};
const supabaseFactory = window.supabase;
const supabasePublicKey =
  authConfig.supabaseAnonKey || authConfig.supabasePublishableKey || "";

const uploadForm = document.getElementById("asset-upload-form");
const uploadStatus = document.getElementById("upload-status");
const uploadGateStatus = document.getElementById("upload-gate-status");
const uploadSubmitBtn = document.getElementById("upload-submit-btn");

const redirectToAssets = () => {
  window.location.replace("assets.html");
};

const withTimeout = async (promise, timeoutMs, label) => {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out`));
    }, timeoutMs);
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

const checkAdminAccess = async (supabaseClient, userId) => {
  if (!userId) {
    return false;
  }

  const configuredAdminId =
    typeof authConfig.adminUserId === "string" ? authConfig.adminUserId.trim() : "";
  if (configuredAdminId && configuredAdminId === userId) {
    return true;
  }

  const { data, error } = await withTimeout(
    supabaseClient
      .from("site_admins")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle(),
    9000,
    "admin check"
  );

  if (error) {
    return false;
  }
  return Boolean(data?.user_id);
};

const handleUploadSubmit = (supabaseClient, session) => async (event) => {
  event.preventDefault();
  if (!session?.user?.id) {
    redirectToAssets();
    return;
  }

  const title = document.getElementById("upload-title")?.value?.trim();
  const description = document.getElementById("upload-description")?.value?.trim() || null;
  const requiredTier = document.getElementById("upload-tier")?.value || "creator";
  const tagsText = document.getElementById("upload-tags")?.value || "";
  const uploadFileInput = document.getElementById("upload-file");
  const publishChecked = true;

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
  uploadStatus.textContent = "Uploading...";

  const uploadResult = await supabaseClient.storage
    .from("asset-files")
    .upload(objectPath, file, { upsert: false });

  if (uploadResult.error) {
    uploadStatus.textContent = `Upload failed: ${uploadResult.error.message}`;
    uploadSubmitBtn.disabled = false;
    return;
  }

  const insertResult = await supabaseClient
    .from("assets")
    .insert({
      slug,
      title,
      description,
      required_tier: requiredTier,
      tags,
      storage_object_path: objectPath,
      is_published: publishChecked
    });

  if (insertResult.error) {
    uploadStatus.textContent = `Saved file but failed to create asset row: ${insertResult.error.message}`;
    uploadSubmitBtn.disabled = false;
    return;
  }

  uploadStatus.textContent = "Asset uploaded successfully. Redirecting...";
  uploadForm.reset();
  uploadSubmitBtn.disabled = false;
  setTimeout(() => {
    window.location.href = "assets.html?uploaded=1";
  }, 700);
};

const initUploadPage = async () => {
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

  const supabaseClient = supabaseFactory.createClient(
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

  let session = null;
  try {
    const { data } = await withTimeout(
      supabaseClient.auth.getSession(),
      10000,
      "getSession"
    );
    session = data?.session || null;
  } catch (_error) {
    redirectToAssets();
    return;
  }

  if (!session?.user?.id) {
    redirectToAssets();
    return;
  }

  const isAdmin = await checkAdminAccess(supabaseClient, session.user.id);
  if (!isAdmin) {
    redirectToAssets();
    return;
  }

  if (uploadGateStatus) {
    uploadGateStatus.textContent = "Admin verified.";
  }
  if (uploadForm) {
    uploadForm.hidden = false;
    uploadForm.addEventListener("submit", handleUploadSubmit(supabaseClient, session));
  }
};

initUploadPage();
