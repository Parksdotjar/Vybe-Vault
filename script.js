const year = document.getElementById("year");
if (year) {
  year.textContent = String(new Date().getFullYear());
}

const pageLoader = document.getElementById("page-loader");
if (pageLoader) {
  const LOADER_MIN_MS = 3800;
  const LOADER_FADE_MS = 520;
  const loaderStart = performance.now();

  const clearLoader = () => {
    pageLoader.classList.add("finishing");
    setTimeout(() => {
      pageLoader.classList.add("hidden");
      document.body.classList.remove("loading");
    }, LOADER_FADE_MS);
  };

  const clearWhenReady = () => {
    const elapsed = performance.now() - loaderStart;
    const waitTime = Math.max(0, LOADER_MIN_MS - elapsed);
    setTimeout(clearLoader, waitTime);
  };

  if (document.readyState === "complete") {
    clearWhenReady();
  } else {
    window.addEventListener("load", clearWhenReady, { once: true });
  }
}

const revealItems = document.querySelectorAll(".reveal");
const revealObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("visible");
        revealObserver.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.15 }
);

revealItems.forEach((item, index) => {
  item.style.transitionDelay = `${index * 50}ms`;
  revealObserver.observe(item);
});

const planButtons = document.querySelectorAll("[data-plan]");
planButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const selectedPlan = button.getAttribute("data-plan");
    // Placeholder handler for billing integration (Stripe/Supabase Edge Functions).
    alert(`${selectedPlan} selected. Connect this button to your checkout flow.`);
  });
});

const supportsFinePointer =
  window.matchMedia("(pointer: fine)").matches &&
  !window.matchMedia("(hover: none)").matches;

if (supportsFinePointer) {
  document.body.classList.add("custom-cursor-enabled");
  const cursor = document.createElement("div");
  cursor.className = "custom-cursor";
  document.body.appendChild(cursor);

  const interactiveSelector = [
    "button",
    ".btn",
    "input",
    "textarea",
    "select",
    "[contenteditable='true']",
  ].join(", ");

  let isCursorActive = false;

  const setCursorActive = (state) => {
    if (state === isCursorActive) {
      return;
    }
    isCursorActive = state;
    cursor.classList.toggle("active", state);
  };

  const playCursorPop = () => {
    cursor.classList.remove("bump");
    void cursor.offsetWidth;
    cursor.classList.add("bump");
  };

  window.addEventListener("mousemove", (event) => {
    cursor.style.left = `${event.clientX}px`;
    cursor.style.top = `${event.clientY}px`;
    cursor.classList.add("visible");

    const hovered = event.target instanceof Element
      ? event.target.closest(interactiveSelector)
      : null;
    setCursorActive(Boolean(hovered));
  });

  window.addEventListener("mouseout", (event) => {
    if (!event.relatedTarget) {
      cursor.classList.remove("visible");
    }
  });

  document.addEventListener(
    "click",
    (event) => {
      if (!(event.target instanceof Element)) {
        return;
      }

      const clickTarget = event.target.closest(
        "a[href], button, .btn, input[type='button'], input[type='submit']"
      );
      if (!clickTarget) {
        return;
      }

      playCursorPop();

      if (
        clickTarget instanceof HTMLAnchorElement &&
        !event.defaultPrevented &&
        event.button === 0 &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.shiftKey &&
        !event.altKey &&
        !clickTarget.hasAttribute("download") &&
        (!clickTarget.target || clickTarget.target === "_self")
      ) {
        event.preventDefault();
        setTimeout(() => {
          window.location.href = clickTarget.href;
        }, 180);
      }
    },
    true
  );
}

const authButton = document.getElementById("discord-login-btn");
const authUserLabel = document.getElementById("auth-user-label");
const authControls = document.querySelector(".auth-controls");
const authConfig = window.VYBE_AUTH_CONFIG || {};
const supabaseFactory = window.supabase;
const supabasePublicKey =
  authConfig.supabaseAnonKey || authConfig.supabasePublishableKey || "";
const defaultProdRedirectUrl = "https://www.vybevault.store/";
const oauthRedirectUrl = (() => {
  if (typeof authConfig.redirectUrl === "string" && authConfig.redirectUrl.startsWith("http")) {
    return authConfig.redirectUrl;
  }
  if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
    return `${window.location.origin}${window.location.pathname}`;
  }
  return defaultProdRedirectUrl;
})();

let authAvatar = document.getElementById("auth-user-avatar");
if (!authAvatar && authControls) {
  authAvatar = document.createElement("img");
  authAvatar.id = "auth-user-avatar";
  authAvatar.className = "auth-avatar hidden";
  authAvatar.alt = "Discord profile avatar";
  authAvatar.loading = "lazy";
  authAvatar.referrerPolicy = "no-referrer";
  authControls.insertBefore(authAvatar, authUserLabel || authButton || null);
}

const getDisplayName = (user) => {
  const metadata = user.user_metadata || {};
  return (
    metadata.full_name ||
    metadata.preferred_username ||
    metadata.user_name ||
    metadata.name ||
    user.email ||
    "discord user"
  );
};

const getAvatarUrl = (user) => {
  const metadata = user.user_metadata || {};
  return (
    metadata.avatar_url ||
    metadata.picture ||
    metadata.avatar ||
    null
  );
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

const getAdminStatus = async (supabaseClient, userId) => {
  if (!supabaseClient || !userId) {
    return false;
  }

  const { data, error } = await supabaseClient
    .from("site_admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    return false;
  }
  return Boolean(data?.user_id);
};

const updateAuthUi = (session, isReady, isAdmin = false) => {
  if (!authButton || !authUserLabel) {
    return;
  }

  if (!isReady) {
    authButton.disabled = true;
    authButton.textContent = "loading...";
    authUserLabel.textContent = "checking session...";
    if (authAvatar) {
      authAvatar.classList.add("hidden");
      authAvatar.removeAttribute("src");
    }
    return;
  }

  authButton.disabled = false;
  if (session?.user) {
    const avatarUrl = getAvatarUrl(session.user);
    authButton.textContent = "logout";
    authUserLabel.textContent = `${getDisplayName(session.user)}${isAdmin ? " (admin)" : ""}`;
    if (authAvatar) {
      if (avatarUrl) {
        authAvatar.src = avatarUrl;
        authAvatar.classList.remove("hidden");
      } else {
        authAvatar.classList.add("hidden");
        authAvatar.removeAttribute("src");
      }
    }
    return;
  }

  authButton.textContent = "login with Discord";
  authUserLabel.textContent = "signed out";
  if (authAvatar) {
    authAvatar.classList.add("hidden");
    authAvatar.removeAttribute("src");
  }
};

const canInitAuth =
  typeof supabaseFactory?.createClient === "function" &&
  typeof authConfig.supabaseUrl === "string" &&
  authConfig.supabaseUrl.includes("supabase.co") &&
  typeof supabasePublicKey === "string" &&
  supabasePublicKey.length > 20;

if (authButton || authUserLabel) {
  updateAuthUi(null, false);
}

if (canInitAuth) {
  const supabaseClient = supabaseFactory.createClient(
    authConfig.supabaseUrl,
    supabasePublicKey
  );

  let didResolveInitialAuth = false;
  let currentAuthSession = null;

  const refreshAuthUi = async () => {
    try {
      const { data, error } = await withTimeout(
        supabaseClient.auth.getSession(),
        9000,
        "getSession"
      );
      if (error) {
        console.error("Failed to load auth session:", error.message);
        updateAuthUi(null, true);
        return null;
      }
      const isAdmin = data.session?.user
        ? await getAdminStatus(supabaseClient, data.session.user.id)
        : false;
      currentAuthSession = data.session || null;
      updateAuthUi(data.session, true, isAdmin);
      didResolveInitialAuth = true;
      return data.session;
    } catch (error) {
      console.error("Auth initialization failed:", error.message);
      updateAuthUi(null, true);
      return null;
    }
  };

  supabaseClient.auth.onAuthStateChange(async (_event, session) => {
    const isAdmin = session?.user
      ? await getAdminStatus(supabaseClient, session.user.id)
      : false;
    currentAuthSession = session || null;
    updateAuthUi(session, true, isAdmin);
    didResolveInitialAuth = true;
  });

  refreshAuthUi();

  // Prevent indefinite "loading..." if the auth request stalls.
  setTimeout(() => {
    if (!didResolveInitialAuth) {
      updateAuthUi(null, true);
    }
  }, 10000);

  if (authButton) {
    authButton.addEventListener("click", async () => {
      let session = currentAuthSession;

      if (!session) {
        try {
          const { data } = await withTimeout(
            supabaseClient.auth.getSession(),
            3500,
            "click getSession"
          );
          session = data?.session || null;
          currentAuthSession = session;
        } catch (_err) {
          session = null;
        }
      }

      if (session) {
        const { error } = await supabaseClient.auth.signOut();
        if (error) {
          console.error("Logout failed:", error.message);
        }
        return;
      }

      const { error } = await supabaseClient.auth.signInWithOAuth({
        provider: "discord",
        options: {
          redirectTo: oauthRedirectUrl
        }
      });

      if (error) {
        console.error("Discord login failed:", error.message);
        alert(`Discord login failed: ${error.message}`);
      }
    });
  }
} else if (authButton || authUserLabel) {
  updateAuthUi(null, true);

  if (authButton) {
    authButton.addEventListener("click", () => {
      alert("Set your Supabase URL and anon key in auth-config.js to enable Discord login.");
    });
  }
}
