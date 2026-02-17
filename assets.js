const assetsGrid = document.getElementById("assets-grid");
const assetsStatus = document.getElementById("assets-status");
const assetSearchInput = document.getElementById("asset-search");
const tagFiltersWrap = document.getElementById("tag-filters");
const currentTierLabel = document.getElementById("current-tier");
const adminUploadWrap = document.getElementById("admin-upload-wrap");
const uploadForm = document.getElementById("asset-upload-form");
const uploadStatus = document.getElementById("upload-status");
const uploadSubmitBtn = document.getElementById("upload-submit-btn");
const authCacheKey = "vybe_auth_ui_cache";

const authConfig = window.VYBE_AUTH_CONFIG || {};
const supabaseFactory = window.supabase;
const supabasePublicKey =
  authConfig.supabaseAnonKey || authConfig.supabasePublishableKey || "";

const tierNames = {
  creator: "Creator",
  creator_plus: "Creator+",
  creator_plus_plus: "Creator++"
};

const tierRank = {
  creator: 1,
  creator_plus: 2,
  creator_plus_plus: 3
};

let supabaseClient = null;
let currentSession = null;
let currentUserTier = null;
let isAdmin = false;
let activeTag = "all";
let allAssets = [];
const urlParams = new URLSearchParams(window.location.search);
const uploadedFlag = urlParams.get("uploaded") === "1";

const readAuthCache = () => {
  try {
    const raw = localStorage.getItem(authCacheKey);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    return parsed;
  } catch (_err) {
    return null;
  }
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

const formatTier = (tier) => tierNames[tier] || "Unknown";

const canDownloadAsset = (asset) => {
  if (!currentSession?.user || !currentUserTier) {
    return false;
  }
  return tierRank[currentUserTier] >= tierRank[asset.required_tier];
};

const setStatus = (message) => {
  if (assetsStatus) {
    assetsStatus.textContent = message;
  }
};

const updateTierLabel = () => {
  if (!currentTierLabel) {
    return;
  }
  const tier = currentUserTier ? formatTier(currentUserTier) : "none";
  currentTierLabel.textContent = `tier: ${tier}${isAdmin ? " | admin" : ""}`;
};

const getTagsFromText = (text) => {
  return [...new Set(
    String(text || "")
      .split(",")
      .map((tag) => tag.trim().toLowerCase())
      .filter(Boolean)
  )];
};

const getUserTier = async () => {
  if (!supabaseClient || !currentSession?.user) {
    return null;
  }

  let data;
  let error;
  try {
    const result = await withTimeout(
      supabaseClient
        .from("entitlements")
        .select("plan,status,current_period_end")
        .eq("user_id", currentSession.user.id)
        .maybeSingle(),
      8000,
      "tier query"
    );
    data = result.data;
    error = result.error;
  } catch (_err) {
    return null;
  }

  if (error || !data) {
    return null;
  }

  const isActive =
    data.status === "active" ||
    data.status === "trialing";
  const periodValid =
    !data.current_period_end ||
    new Date(data.current_period_end).getTime() > Date.now();

  if (!isActive || !periodValid) {
    return null;
  }
  return data.plan;
};

const getAdminStatus = async () => {
  if (!supabaseClient || !currentSession?.user) {
    return false;
  }

  let data;
  let error;
  try {
    const result = await withTimeout(
      supabaseClient
        .from("site_admins")
        .select("user_id")
        .eq("user_id", currentSession.user.id)
        .maybeSingle(),
      8000,
      "admin check"
    );
    data = result.data;
    error = result.error;
  } catch (_err) {
    return false;
  }

  if (error) {
    return false;
  }
  return Boolean(data?.user_id);
};

const applyFilters = () => {
  const query = String(assetSearchInput?.value || "").trim().toLowerCase();
  const filtered = allAssets.filter((asset) => {
    const matchesSearch =
      !query ||
      asset.title.toLowerCase().includes(query) ||
      String(asset.description || "").toLowerCase().includes(query) ||
      (asset.tags || []).some((tag) => tag.toLowerCase().includes(query));

    const matchesTag =
      activeTag === "all" ||
      (asset.tags || []).some((tag) => tag.toLowerCase() === activeTag);

    return matchesSearch && matchesTag;
  });

  renderAssets(filtered);
  setStatus(filtered.length ? `${filtered.length} asset(s)` : "No assets found.");
};

const renderTagFilters = () => {
  if (!tagFiltersWrap) {
    return;
  }
  const tags = [...new Set(allAssets.flatMap((asset) => asset.tags || []).map((tag) => tag.toLowerCase()))];
  const all = ["all", ...tags];

  tagFiltersWrap.innerHTML = "";
  all.forEach((tag) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `tag-chip ${activeTag === tag ? "active" : ""}`;
    button.textContent = tag === "all" ? "all tags" : tag;
    button.addEventListener("click", () => {
      activeTag = tag;
      renderTagFilters();
      applyFilters();
    });
    tagFiltersWrap.appendChild(button);
  });
};

const renderAssets = (assets) => {
  if (!assetsGrid) {
    return;
  }

  assetsGrid.innerHTML = "";

  assets.forEach((asset) => {
    const card = document.createElement("article");
    card.className = "asset-card reveal visible";

    const locked = !canDownloadAsset(asset);
    const tierText = formatTier(asset.required_tier);

    const tagsHtml = (asset.tags || [])
      .map((tag) => `<span class="mini-tag">${tag}</span>`)
      .join("");

    card.innerHTML = `
      <h3>${asset.title}</h3>
      <p>${asset.description || "No description provided."}</p>
      <p class="asset-meta">
        tier required: <strong>${tierText}</strong>
        ${locked ? '<span class="lock-note">locked</span>' : '<span class="unlock-note">unlocked</span>'}
      </p>
      <div class="mini-tags">${tagsHtml}</div>
      <div class="asset-actions">
        <button class="btn ${locked ? "btn-ghost" : "btn-primary"}" data-download-id="${asset.id}" ${locked ? "disabled" : ""}>
          ${locked ? "tier locked" : "download"}
        </button>
      </div>
    `;

    assetsGrid.appendChild(card);
  });

  const buttons = assetsGrid.querySelectorAll("[data-download-id]");
  buttons.forEach((button) => {
    button.addEventListener("click", async () => {
      const assetId = button.getAttribute("data-download-id");
      const asset = allAssets.find((item) => item.id === assetId);
      if (!asset || !supabaseClient || !currentSession?.user) {
        return;
      }
      const { data, error } = await supabaseClient.storage
        .from("asset-files")
        .createSignedUrl(asset.storage_object_path, 60, { download: true });

      if (error || !data?.signedUrl) {
        setStatus("Download failed. Your tier may not have access.");
        return;
      }

      await supabaseClient
        .from("asset_downloads")
        .insert({ user_id: currentSession.user.id, asset_id: asset.id });

      window.location.href = data.signedUrl;
    });
  });
};

const loadAssets = async () => {
  if (!supabaseClient) {
    return;
  }
  setStatus("Loading assets...");

  let data;
  let error;
  try {
    let query = supabaseClient
      .from("assets")
      .select("id,title,description,required_tier,tags,storage_object_path,is_published,created_at")
      .order("created_at", { ascending: false });

    if (!isAdmin) {
      query = query.eq("is_published", true);
    }

    const result = await withTimeout(query, 9000, "assets query");
    data = result.data;
    error = result.error;
  } catch (_err) {
    setStatus("Could not load assets (timeout).");
    return;
  }

  if (error) {
    setStatus("Could not load assets.");
    return;
  }

  allAssets = data || [];
  renderTagFilters();
  applyFilters();
};

const handleUploadSubmit = async (event) => {
  event.preventDefault();
  if (!supabaseClient || !currentSession?.user || !isAdmin) {
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

  uploadStatus.textContent = "Asset uploaded successfully.";
  uploadForm.reset();
  uploadSubmitBtn.disabled = false;
  await loadAssets();
};

const initAssetsPage = async () => {
  const canInitAuth =
    typeof supabaseFactory?.createClient === "function" &&
    typeof authConfig.supabaseUrl === "string" &&
    authConfig.supabaseUrl.includes("supabase.co") &&
    typeof supabasePublicKey === "string" &&
    supabasePublicKey.length > 20;

  if (!canInitAuth) {
    setStatus("Set auth-config.js first.");
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

  const cached = readAuthCache();
  if (cached?.isAdmin && adminUploadWrap) {
    adminUploadWrap.hidden = false;
  }

  const applySessionState = async () => {
    currentUserTier = await getUserTier();
    isAdmin = await getAdminStatus();
    updateTierLabel();
    if (adminUploadWrap) {
      adminUploadWrap.hidden = !isAdmin;
    }
    await loadAssets();
  };

  let didResolveInitialSession = false;
  try {
    const { data } = await withTimeout(
      supabaseClient.auth.getSession(),
      9000,
      "auth session"
    );
    currentSession = data?.session || null;
    didResolveInitialSession = true;
  } catch (_err) {
    currentSession = null;
  }

  if (didResolveInitialSession) {
    await applySessionState();
  } else {
    updateTierLabel();
    await loadAssets();
    // Recover from late auth responses after timeout instead of staying signed out forever.
    supabaseClient.auth.getSession().then(async ({ data }) => {
      currentSession = data?.session || null;
      await applySessionState();
    }).catch(() => {});
  }

  if (assetSearchInput) {
    assetSearchInput.addEventListener("input", applyFilters);
  }

  if (uploadForm) {
    uploadForm.addEventListener("submit", handleUploadSubmit);
  }

  supabaseClient.auth.onAuthStateChange(async (_event, session) => {
    currentSession = session;
    await applySessionState();
  });

  if (uploadedFlag) {
    setStatus("Upload complete. Refreshing assets...");
    setTimeout(() => {
      loadAssets();
      history.replaceState({}, "", window.location.pathname);
    }, 1200);
  }
};

initAssetsPage();
