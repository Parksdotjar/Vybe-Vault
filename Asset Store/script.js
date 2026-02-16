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
