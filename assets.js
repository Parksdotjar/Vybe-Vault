const assetsGrid = document.getElementById("assets-grid");
const assetsStatus = document.getElementById("assets-status");
const assetSearchInput = document.getElementById("asset-search");
const tagFiltersWrap = document.getElementById("tag-filters");
const currentTierLabel = document.getElementById("current-tier");
const adminUploadWrap = document.getElementById("admin-upload-wrap");
const previewModal = document.getElementById("asset-preview-modal");
const previewBody = document.getElementById("asset-preview-body");

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
const signedUrlCache = new Map();
const urlParams = new URLSearchParams(window.location.search);
const uploadedFlag = urlParams.get("uploaded") === "1";

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

const setStatus = (message) => {
  if (assetsStatus) {
    assetsStatus.textContent = message;
  }
};

const formatTier = (tier) => tierNames[tier] || "Unknown";

const getExt = (path) => {
  const idx = path.lastIndexOf(".");
  return idx >= 0 ? path.slice(idx + 1).toLowerCase() : "";
};

const getMediaType = (path) => {
  const ext = getExt(path);
  if (["mp4", "webm", "mov", "m4v"].includes(ext)) {
    return "video";
  }
  if (["mp3", "wav", "ogg", "m4a", "flac"].includes(ext)) {
    return "audio";
  }
  if (["jpg", "jpeg", "png", "gif", "webp"].includes(ext)) {
    return "image";
  }
  return "file";
};

const canDownloadAsset = (asset) => {
  if (isAdmin) {
    return true;
  }
  if (!currentSession?.user || !currentUserTier) {
    return false;
  }
  return tierRank[currentUserTier] >= tierRank[asset.required_tier];
};

const updateTierLabel = () => {
  if (!currentTierLabel) {
    return;
  }
  const tier = currentUserTier ? formatTier(currentUserTier) : "none";
  currentTierLabel.textContent = `tier: ${tier}${isAdmin ? " | admin" : ""}`;
};

const getUserTier = async () => {
  if (!supabaseClient || !currentSession?.user?.id) {
    return null;
  }
  try {
    const { data, error } = await withTimeout(
      supabaseClient
        .from("entitlements")
        .select("plan,status,current_period_end")
        .eq("user_id", currentSession.user.id)
        .maybeSingle(),
      12000,
      "tier query"
    );
    if (error || !data) {
      return null;
    }
    const isActive = data.status === "active" || data.status === "trialing";
    const periodValid =
      !data.current_period_end ||
      new Date(data.current_period_end).getTime() > Date.now();
    return isActive && periodValid ? data.plan : null;
  } catch (_err) {
    return null;
  }
};

const getAdminStatus = async () => {
  if (!supabaseClient || !currentSession?.user?.id) {
    return false;
  }
  const configuredAdminId =
    typeof authConfig.adminUserId === "string" ? authConfig.adminUserId.trim() : "";
  if (configuredAdminId && configuredAdminId === currentSession.user.id) {
    return true;
  }
  try {
    const { data, error } = await withTimeout(
      supabaseClient
        .from("site_admins")
        .select("user_id")
        .eq("user_id", currentSession.user.id)
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

const getSignedUrlForPath = async (path, downloadName = null) => {
  const cacheKey = `${path}|${downloadName || ""}`;
  const cached = signedUrlCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.url;
  }

  const options = downloadName ? { download: downloadName } : {};
  const { data, error } = await supabaseClient.storage
    .from("asset-files")
    .createSignedUrl(path, 180, options);

  if (error || !data?.signedUrl) {
    throw new Error(error?.message || "signed URL error");
  }
  signedUrlCache.set(cacheKey, {
    url: data.signedUrl,
    expiresAt: Date.now() + 170000
  });
  return data.signedUrl;
};

const closePreview = () => {
  if (!previewModal || !previewBody) {
    return;
  }
  previewBody.innerHTML = "";
  previewModal.classList.add("hidden");
  previewModal.setAttribute("aria-hidden", "true");
};

const openPreview = async (asset) => {
  if (!previewModal || !previewBody) {
    return;
  }
  previewBody.innerHTML = "<p>Loading preview...</p>";
  previewModal.classList.remove("hidden");
  previewModal.setAttribute("aria-hidden", "false");

  try {
    const url = await getSignedUrlForPath(asset.storage_object_path);
    const mediaType = getMediaType(asset.storage_object_path);
    if (mediaType === "video") {
      previewBody.innerHTML = `<video controls preload="metadata" src="${url}" class="preview-media"></video>`;
      return;
    }
    if (mediaType === "audio") {
      previewBody.innerHTML = `<audio controls preload="metadata" src="${url}" class="preview-media"></audio>`;
      return;
    }
    if (mediaType === "image") {
      previewBody.innerHTML = `<img src="${url}" alt="Asset preview" class="preview-media preview-image" />`;
      return;
    }
    previewBody.innerHTML = `<p>No inline preview for this file type.</p><p><a class="btn btn-primary" href="${url}" target="_blank" rel="noopener noreferrer">open file</a></p>`;
  } catch (error) {
    previewBody.innerHTML = `<p>Preview unavailable: ${error.message}</p>`;
  }
};

const triggerDirectDownload = async (asset) => {
  try {
    const fileName = asset.storage_object_path.split("/").pop() || "asset";
    const url = await getSignedUrlForPath(asset.storage_object_path, fileName);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.rel = "noopener noreferrer";
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
  } catch (error) {
    setStatus(`Download failed: ${error.message}`);
  }
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
        <button class="btn btn-ghost" data-preview-id="${asset.id}">preview</button>
        <button class="btn ${locked ? "btn-ghost" : "btn-primary"}" data-download-id="${asset.id}" ${locked ? "disabled" : ""}>
          ${locked ? "tier locked" : "direct download"}
        </button>
      </div>
    `;
    assetsGrid.appendChild(card);
  });

  assetsGrid.querySelectorAll("[data-preview-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.getAttribute("data-preview-id");
      const asset = allAssets.find((item) => item.id === id);
      if (asset) {
        openPreview(asset);
      }
    });
  });

  assetsGrid.querySelectorAll("[data-download-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = button.getAttribute("data-download-id");
      const asset = allAssets.find((item) => item.id === id);
      if (!asset) {
        return;
      }
      await triggerDirectDownload(asset);
      if (currentSession?.user?.id) {
        await supabaseClient
          .from("asset_downloads")
          .insert({ user_id: currentSession.user.id, asset_id: asset.id });
      }
    });
  });
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

const loadAssets = async () => {
  if (!supabaseClient) {
    return;
  }
  setStatus("Loading assets...");

  try {
    let query = supabaseClient
      .from("assets")
      .select("id,title,description,required_tier,tags,storage_object_path,is_published,created_at")
      .order("created_at", { ascending: false });

    if (!isAdmin) {
      query = query.eq("is_published", true);
    }

    const { data, error } = await withTimeout(query, 12000, "assets query");
    if (error) {
      setStatus(`Could not load assets: ${error.message}`);
      return;
    }

    allAssets = data || [];
    renderTagFilters();
    applyFilters();
  } catch (error) {
    setStatus(`Could not load assets: ${error.message}`);
  }
};

const applySessionState = async () => {
  isAdmin = await getAdminStatus();
  currentUserTier = await getUserTier();
  updateTierLabel();
  if (adminUploadWrap) {
    adminUploadWrap.hidden = !isAdmin;
  }
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

  if (assetSearchInput) {
    assetSearchInput.addEventListener("input", applyFilters);
  }

  if (previewModal) {
    previewModal.addEventListener("click", (event) => {
      const target = event.target;
      if (target instanceof Element && target.getAttribute("data-close-preview") === "1") {
        closePreview();
      }
    });
  }

  try {
    const { data } = await withTimeout(
      supabaseClient.auth.getSession(),
      16000,
      "auth session"
    );
    currentSession = data?.session || null;
  } catch (_err) {
    currentSession = null;
  }

  await applySessionState();

  supabaseClient.auth.onAuthStateChange(async (_event, session) => {
    currentSession = session || null;
    await applySessionState();
  });

  if (uploadedFlag) {
    setStatus("Upload complete. Refreshing assets...");
    setTimeout(async () => {
      await loadAssets();
      history.replaceState({}, "", window.location.pathname);
    }, 1400);
  }
};

initAssetsPage();
