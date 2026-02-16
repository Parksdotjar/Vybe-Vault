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
const authConfig = window.VYBE_AUTH_CONFIG || {};
const supabaseFactory = window.supabase;

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

const updateAuthUi = (session, isReady) => {
  if (!authButton || !authUserLabel) {
    return;
  }

  if (!isReady) {
    authButton.disabled = true;
    authButton.textContent = "loading...";
    authUserLabel.textContent = "checking session...";
    return;
  }

  authButton.disabled = false;
  if (session?.user) {
    authButton.textContent = "logout";
    authUserLabel.textContent = getDisplayName(session.user);
    return;
  }

  authButton.textContent = "login with Discord";
  authUserLabel.textContent = "signed out";
};

const canInitAuth =
  typeof supabaseFactory?.createClient === "function" &&
  typeof authConfig.supabaseUrl === "string" &&
  authConfig.supabaseUrl.includes("supabase.co") &&
  typeof authConfig.supabaseAnonKey === "string" &&
  authConfig.supabaseAnonKey.length > 20;

if (authButton || authUserLabel) {
  updateAuthUi(null, false);
}

if (canInitAuth) {
  const supabaseClient = supabaseFactory.createClient(
    authConfig.supabaseUrl,
    authConfig.supabaseAnonKey
  );

  const refreshAuthUi = async () => {
    const { data, error } = await supabaseClient.auth.getSession();
    if (error) {
      console.error("Failed to load auth session:", error.message);
      updateAuthUi(null, true);
      return null;
    }
    updateAuthUi(data.session, true);
    return data.session;
  };

  supabaseClient.auth.onAuthStateChange((_event, session) => {
    updateAuthUi(session, true);
  });

  refreshAuthUi();

  if (authButton) {
    authButton.addEventListener("click", async () => {
      const { data } = await supabaseClient.auth.getSession();
      if (data.session) {
        const { error } = await supabaseClient.auth.signOut();
        if (error) {
          console.error("Logout failed:", error.message);
        }
        return;
      }

      const { error } = await supabaseClient.auth.signInWithOAuth({
        provider: "discord",
        options: {
          redirectTo: window.location.href
        }
      });

      if (error) {
        console.error("Discord login failed:", error.message);
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
