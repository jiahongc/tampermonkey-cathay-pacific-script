// ==UserScript==
// @name         Cathay Award Helper
// @namespace    codex.local
// @version      0.3.0
// @description  Automate Cathay award searches from the homepage and keep only nonstop matches.
// @author       jiahongc
// @license      MIT
// @match        https://*.cathaypacific.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==
/* eslint-disable */

(function () {
  "use strict";

  const PANEL_ID = "cx-award-helper-panel";
  const STYLE_ID = "cx-award-helper-style";
  const SETTINGS_KEY = "cx-award-helper-settings-v2";
  const WINDOW_NAME_PREFIX = "__cx_award_helper__:";
  const MAX_DAYS = 14;
  const DEFAULT_DELAY_S = 2;
  const HOMEPAGE_URL = "https://www.cathaypacific.com/cx/en_US.html";
  const CABIN_CODES = ["Y", "PY", "J", "F"];
  const DEFAULT_SETTINGS = {
    routePreset: "JFK-HKG",
    origin: "JFK",
    destination: "HKG",
    startDate: "",
    days: 3,
    adults: 1,
    cabins: ["PY"],
    directOnly: true,
    delayS: DEFAULT_DELAY_S,
    // Legacy compat: delayMs is converted to delayS on load
  };
  const ROUTE_PRESETS = [
    { value: "JFK-HKG", label: "JFK \u21c4 HKG", origin: "JFK", destination: "HKG" },
    { value: "LAX-HKG", label: "LAX \u21c4 HKG", origin: "LAX", destination: "HKG" },
    { value: "SFO-HKG", label: "SFO \u21c4 HKG", origin: "SFO", destination: "HKG" },
    { value: "", label: "Custom route", origin: "", destination: "" },
  ];
  const CABIN_LABELS = {
    Y: "Economy",
    PY: "Premium Economy",
    J: "Business",
    F: "First",
  };

  const state = {
    running: false,
    stopping: false,
    status: 'Start from Cathay\'s homepage with "Book with miles" turned on.',
    results: [],
  };

  function shouldStop() {
    if (state.stopping) return true;
    const run = loadRun();
    return run && !run.active;
  }

  function sleep(ms) {
    const total = Math.max(0, Number(ms) || 0);
    if (total <= 250) {
      return new Promise((resolve) => setTimeout(resolve, total));
    }
    return new Promise((resolve) => {
      const started = Date.now();
      const tick = () => {
        if (shouldStop()) {
          resolve();
          return;
        }
        const elapsed = Date.now() - started;
        if (elapsed >= total) {
          resolve();
          return;
        }
        setTimeout(tick, Math.min(250, total - elapsed));
      };
      setTimeout(tick, Math.min(250, total));
    });
  }

  function getRunDelayMs(run, multiplier, minimumMs) {
    const base = Math.max(DEFAULT_DELAY_S * 1000, Number(run && run.delayMs) || 0);
    return Math.max(minimumMs || 0, Math.round(base * (multiplier || 1)));
  }

  function armRunCooldown(run, waitMs, reason) {
    if (!run || !waitMs) {
      return;
    }
    run.cooldownUntil = Date.now() + waitMs;
    saveRun(run);
    console.log("[CX Helper] Armed cooldown:", Math.ceil(waitMs / 1000), "s", reason || "");
  }

  async function waitForRunCooldown(run, statusMessage) {
    if (!run || !run.cooldownUntil) {
      return;
    }
    let remaining = Number(run.cooldownUntil) - Date.now();
    if (remaining <= 0) {
      delete run.cooldownUntil;
      saveRun(run);
      return;
    }
    const message = statusMessage || `Cooling down for ${Math.ceil(remaining / 1000)}s before the next Cathay request...`;
    console.log("[CX Helper] Cooldown active:", Math.ceil(remaining / 1000), "s");
    setStatus(message);
    while (remaining > 0 && !shouldStop()) {
      await sleep(Math.min(remaining, 1000));
      remaining = Number(run.cooldownUntil) - Date.now();
    }
    delete run.cooldownUntil;
    saveRun(run);
  }

  function loadSettings() {
    // Try localStorage first (same-origin persistence)
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null");
    } catch (_) {}

    // Also check the run object in window.name (survives cross-origin navigation)
    const run = loadRun();
    if (run && run.settings) {
      saved = Object.assign({}, saved || {}, run.settings);
    }

    const merged = Object.assign({}, DEFAULT_SETTINGS, saved || {});
    // Legacy: convert delayMs to delayS
    if (merged.delayMs && !merged.delayS) {
      merged.delayS = Math.round(merged.delayMs / 1000);
    }
    if (!Array.isArray(merged.cabins) || merged.cabins.length === 0) {
      merged.cabins = merged.cabin ? [merged.cabin] : DEFAULT_SETTINGS.cabins.slice();
    }
    merged.cabins = merged.cabins.filter((code, index) => CABIN_CODES.includes(code) && merged.cabins.indexOf(code) === index);
    if (merged.cabins.length === 0) {
      merged.cabins = DEFAULT_SETTINGS.cabins.slice();
    }
    merged.cabin = merged.cabins[0];
    delete merged.delayMs;
    delete merged.cabinPreset;
    return merged;
  }

  function getPanelSettingsSource() {
    const run = loadRun();
    if (run && run.active) {
      const merged = Object.assign({}, loadSettings(), run.settings || {});
      if (run.delayMs) {
        merged.delayS = Math.max(1, Math.round(run.delayMs / 1000));
      }
      if (Array.isArray(run.cabinCodes) && run.cabinCodes.length) {
        merged.cabins = run.cabinCodes.slice();
      }
      return merged;
    }
    return loadSettings();
  }

  function saveSettings(settings) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }

  function clearSettings() {
    localStorage.removeItem(SETTINGS_KEY);
  }

  function loadWindowPayload() {
    try {
      const raw = String(window.name || "");
      if (!raw.startsWith(WINDOW_NAME_PREFIX)) {
        return { run: null, logs: [] };
      }
      const parsed = JSON.parse(raw.slice(WINDOW_NAME_PREFIX.length) || "null");
      if (parsed && typeof parsed === "object" && ("run" in parsed || "logs" in parsed)) {
        return {
          run: parsed.run || null,
          logs: Array.isArray(parsed.logs) ? parsed.logs : [],
        };
      }
      return { run: parsed || null, logs: [] };
    } catch (_) {
      return { run: null, logs: [] };
    }
  }

  function saveWindowPayload(payload) {
    const next = {
      run: payload && payload.run ? payload.run : null,
      logs: payload && Array.isArray(payload.logs) ? payload.logs : [],
    };
    window.name = WINDOW_NAME_PREFIX + JSON.stringify(next);
  }

  function loadRun() {
    return loadWindowPayload().run;
  }

  function saveRun(run) {
    const payload = loadWindowPayload();
    payload.run = run || null;
    saveWindowPayload(payload);
  }

  function clearRun() {
    const payload = loadWindowPayload();
    payload.run = null;
    saveWindowPayload(payload);
  }

  function getField(id) {
    return document.getElementById(id);
  }

  function normalizeText(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  function normalizeAirportCode(text) {
    const raw = String(text || "").trim().toUpperCase();
    const parenMatch = raw.match(/\(([A-Z]{3})\)/);
    if (parenMatch) {
      return parenMatch[1];
    }
    const boundaryMatch = raw.match(/\b([A-Z]{3})\b/);
    if (boundaryMatch) {
      return boundaryMatch[1];
    }
    const collapsed = raw.replace(/[^A-Z]/g, "");
    if (!/^[A-Z]{3}$/.test(collapsed)) {
      throw new Error(`Invalid airport code: ${text}`);
    }
    return collapsed;
  }

  function normalizeDate(text) {
    const raw = String(text || "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      return raw;
    }
    const slashMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (slashMatch) {
      const month = String(slashMatch[1]).padStart(2, "0");
      const day = String(slashMatch[2]).padStart(2, "0");
      return `${slashMatch[3]}-${month}-${day}`;
    }
    throw new Error(`Invalid date: ${text}`);
  }

  function addDays(dateText, daysToAdd) {
    const date = new Date(`${dateText}T00:00:00`);
    date.setDate(date.getDate() + daysToAdd);
    return date.toISOString().slice(0, 10);
  }

  function formatDisplayDate(dateText) {
    const date = new Date(`${dateText}T00:00:00`);
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  function escapeRegExp(text) {
    return String(text || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function getCabinLabel(cabinCode) {
    return CABIN_LABELS[cabinCode] || cabinCode || "";
  }

  function matchesCabinTileText(text, cabinCode) {
    const label = getCabinLabel(cabinCode);
    const normalized = normalizeText(text);
    if (!label || !normalized) {
      return false;
    }
    const exact = new RegExp(`^${escapeRegExp(label)}(?:\\s+class)?$`, "i");
    const priced = new RegExp(`^${escapeRegExp(label)}(?:\\s+class)?\\s+from\\b`, "i");
    if (exact.test(normalized) || priced.test(normalized)) {
      return true;
    }
    return normalized.length <= 40 &&
      new RegExp(`^${escapeRegExp(label)}(?:\\s+class)?\\b`, "i").test(normalized) &&
      /(?:A\s*\d{2,3}[,.]?\d{3}|\d{2,3}[,.]?\d{3})/.test(normalized);
  }

  function normalizeCabinCodes(input) {
    const raw = Array.isArray(input) ? input : input ? [input] : [];
    const filtered = raw.filter((code, index) => CABIN_CODES.includes(code) && raw.indexOf(code) === index);
    return filtered.length ? filtered : DEFAULT_SETTINGS.cabins.slice();
  }

  function getRunCabinCodes(runOrSettings) {
    return normalizeCabinCodes(
      (runOrSettings && (runOrSettings.cabinCodes || runOrSettings.cabins)) ||
      (runOrSettings && runOrSettings.cabin)
    );
  }

  function getSeedCabin(run) {
    return run.seedCabin || getRunCabinCodes(run)[0];
  }

  function cabinSortValue(code) {
    const index = CABIN_CODES.indexOf(code);
    return index === -1 ? CABIN_CODES.length : index;
  }

  function getCabinCheckboxIds() {
    return {
      Y: "cxah-cabin-y",
      PY: "cxah-cabin-py",
      J: "cxah-cabin-j",
      F: "cxah-cabin-f",
    };
  }

  function getRunLastDate(run) {
    return addDays(run.startDate, Math.max(0, (run.days || 1) - 1));
  }

  function isDateWithinRun(run, dateText) {
    return Boolean(dateText) && dateText >= run.startDate && dateText <= getRunLastDate(run);
  }

  function getDateOffset(run, dateText) {
    const start = new Date(`${run.startDate}T00:00:00`);
    const end = new Date(`${dateText}T00:00:00`);
    return Math.round((end - start) / 86400000);
  }

  function readFormSettings() {
    const routePreset = getField("cxah-route-preset").value;
    const route = ROUTE_PRESETS.find((item) => item.value === routePreset);
    const cabinIds = getCabinCheckboxIds();
    const cabins = CABIN_CODES.filter((code) => {
      const el = getField(cabinIds[code]);
      return el && el.checked;
    });
    if (cabins.length === 0) {
      throw new Error("Select at least one cabin.");
    }
    return {
      routePreset,
      origin: getField("cxah-origin").value.trim() || (route && route.origin) || "",
      destination: getField("cxah-destination").value.trim() || (route && route.destination) || "",
      startDate: getField("cxah-start-date").value,
      days: Math.max(1, Math.min(MAX_DAYS, Number(getField("cxah-days").value) || DEFAULT_SETTINGS.days)),
      adults: Math.max(1, Math.min(4, Number(getField("cxah-adults").value) || DEFAULT_SETTINGS.adults)),
      cabins: normalizeCabinCodes(cabins),
      directOnly: Boolean(getField("cxah-direct-only").checked),
      delayS: Math.max(1, Number(getField("cxah-delay").value) || DEFAULT_DELAY_S),
    };
  }

  function fillForm(settings) {
    const cabins = getRunCabinCodes(settings);
    const cabinIds = getCabinCheckboxIds();
    getField("cxah-route-preset").value = settings.routePreset || "";
    getField("cxah-origin").value = settings.origin || "";
    getField("cxah-destination").value = settings.destination || "";
    getField("cxah-start-date").value = settings.startDate || "";
    getField("cxah-days").value = settings.days || DEFAULT_SETTINGS.days;
    getField("cxah-adults").value = settings.adults || DEFAULT_SETTINGS.adults;
    CABIN_CODES.forEach((code) => {
      const el = getField(cabinIds[code]);
      if (el) {
        el.checked = cabins.includes(code);
      }
    });
    getField("cxah-direct-only").checked = settings.directOnly !== false;
    getField("cxah-delay").value = settings.delayS || DEFAULT_DELAY_S;
  }

  function buildOptions(options, selectedValue) {
    return options
      .map((option) => {
        const selected = option.value === selectedValue ? "selected" : "";
        return `<option value="${option.value}" ${selected}>${option.label}</option>`;
      })
      .join("");
  }

  function applyRoutePreset() {
    const selected = ROUTE_PRESETS.find((item) => item.value === getField("cxah-route-preset").value);
    if (!selected) {
      return;
    }
    if (selected.origin) {
      getField("cxah-origin").value = selected.origin;
    }
    if (selected.destination) {
      getField("cxah-destination").value = selected.destination;
    }
  }

  function onSwapRoute() {
    const originEl = getField("cxah-origin");
    const destEl = getField("cxah-destination");
    if (!originEl || !destEl) return;
    const tmp = originEl.value;
    originEl.value = destEl.value;
    destEl.value = tmp;
    // Update route preset dropdown to match, or fall back to Custom
    const presetEl = getField("cxah-route-preset");
    if (presetEl) {
      const match = ROUTE_PRESETS.find(
        (p) => p.origin === originEl.value && p.destination === destEl.value
      );
      presetEl.value = match ? match.value : "";
    }
  }

  function setStatus(message) {
    state.status = message;
    const el = document.querySelector(`#${PANEL_ID} .cxah-status`);
    if (el) {
      el.textContent = message;
    }
  }

  function isInsideHelperPanel(el) {
    return Boolean(el && el.closest && el.closest(`#${PANEL_ID}`));
  }

  function findVisibleElements(selector) {
    return Array.from(document.querySelectorAll(selector)).filter((el) => {
      if (isInsideHelperPanel(el)) {
        return false;
      }
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
  }

  function findClickableByText(regex) {
    return findVisibleElements("button, a, div, span, label").find((el) => {
      const text = normalizeText(el.innerText);
      if (!regex.test(text)) {
        return false;
      }
      const clickable = el.closest("button, a, label, [role='button'], [tabindex]");
      return Boolean(clickable || el.tagName === "BUTTON" || el.tagName === "A");
    });
  }

  function clickElement(el) {
    if (!el || shouldStop()) {
      return;
    }
    const target = el.closest("button, a, label, [role='button'], [tabindex]") || el;
    // Use full pointer+mouse+click sequence for React Aria compatibility
    forceClick(target);
  }

  function isHomepage() {
    const text = document.body ? document.body.innerText : "";
    return /Book a trip/.test(text) && /(Redeem flights|Search flights)/.test(text);
  }

  function isResultsLikePage() {
    const text = document.body ? document.body.innerText : "";
    if (/Select flights/.test(text) || /Lowest miles shown on the calendar/.test(text)) {
      return true;
    }
    if (hasNoAvailabilityModalText(text)) {
      return true;
    }
    const hasDepartHeader = /\bDepart\b/i.test(text);
    const hasDetails = /View full details|Flight details/i.test(text);
    const hasFilter = /\bFilter\b/i.test(text);
    const hasDateStrip = getVisibleCalendarCells().length >= 5;
    return hasDateStrip && hasDepartHeader && (hasDetails || hasFilter);
  }

  function isResultsPage() {
    return isResultsLikePage();
  }

  function isRecoverableErrorPage() {
    const text = document.body ? document.body.innerText : "";
    return (/^Error$/m.test(text) || /\bError\b/.test(text)) &&
      (/system is already processing a request from you/i.test(text) || /\(3002\)/.test(text));
  }

  async function recoverFromErrorPage(run) {
    if (!isRecoverableErrorPage()) {
      return false;
    }
    const dateText = addDays(run.startDate, run.offset || 0);
    const cabinCode = getSeedCabin(run);
    const retryKey = `${dateText}__${cabinCode}`;
    run.errorRecoveries = run.errorRecoveries || {};
    run.errorRecoveries[retryKey] = (run.errorRecoveries[retryKey] || 0) + 1;
    const retryCount = run.errorRecoveries[retryKey];
    console.log("[CX Helper] Recoverable Cathay error page detected", "retry=", retryCount, "date=", dateText, "cabin=", cabinCode);
    if (retryCount >= 2) {
      console.log("[CX Helper] Repeated recoverable error for", dateText, cabinCode, "- marking unavailable and advancing");
      if (!hasRunResult(run, dateText, cabinCode)) {
        upsertRunResult(run, buildUnavailableResult(dateText, cabinCode));
      }
      const nextPending = findNextPendingSeed(run);
      if (!nextPending) {
        run.active = false;
        run.phase = "done";
        saveRunAndRender(run);
        setStatus(`Finished ${run.results.length} date/cabin result${run.results.length === 1 ? "" : "s"}.`);
        window.location.assign(HOMEPAGE_URL);
        return true;
      }
      run.offset = nextPending.offset;
      run.seedCabin = nextPending.cabinCode;
    }
    run.phase = "go-homepage";
    armRunCooldown(run, getRunDelayMs(run, 5, 10000), "recovering from Cathay error page");
    saveRun(run);
    setStatus("Recovering from Cathay error page...");
    window.location.assign(HOMEPAGE_URL);
    return true;
  }

  function hasMilesToggleEnabled() {
    const text = document.body ? document.body.innerText : "";
    return /Redeem flights/.test(text);
  }

  function findHomepageSearchButton() {
    return findVisibleElements("button, a, div").find((el) => {
      const text = normalizeText(el.innerText);
      return /^(Redeem flights|Search flights)$/.test(text);
    });
  }

  function navigateToHomepage(run, reason) {
    if (run) {
      run.phase = "go-homepage";
      saveRunAndRender(run);
    }
    console.log("[CX Helper] Navigating directly to homepage", reason || "");
    setStatus(reason || "Returning to Cathay homepage...");
    window.location.assign(HOMEPAGE_URL);
  }

  function findCheckboxByLabelText(labelRegex) {
    const labels = findVisibleElements("label, div, span");
    const hit = labels.find((el) => labelRegex.test(normalizeText(el.innerText)));
    if (!hit) {
      return null;
    }
    const label = hit.closest("label") || hit;
    const forId = label.getAttribute && label.getAttribute("for");
    if (forId) {
      return document.getElementById(forId);
    }
    return label.querySelector("input[type='checkbox']") || label.previousElementSibling || label.nextElementSibling;
  }

  async function ensureDirectFlightsEnabled() {
    // Try finding the checkbox by label
    const checkbox = findCheckboxByLabelText(/^Direct flights$/i);
    if (checkbox) {
      if (checkbox.checked === true) {
        console.log("[CX Helper] Direct flights already checked");
        return;
      }
      console.log("[CX Helper] Clicking Direct flights checkbox");
      forceToggle(checkbox);
      await sleep(1500);
      return;
    }
    // Fallback: find the "Direct flights" text and click near it
    const label = findClickableByText(/^Direct flights$/i);
    if (label) {
      console.log("[CX Helper] Clicking Direct flights label");
      forceClick(label);
      await sleep(1500);
    } else {
      console.log("[CX Helper] Direct flights checkbox/label not found");
    }
  }

  /**
   * Try multiple click strategies on an element.
   * Cathay uses a JS framework that may not respond to synthetic MouseEvents.
   */
  function forceClick(el) {
    if (!el || shouldStop()) {
      return;
    }
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const opts = { bubbles: true, cancelable: true, clientX: cx, clientY: cy, view: window };
    // Strategy 1: full pointer event sequence (what modern frameworks expect)
    el.dispatchEvent(new PointerEvent("pointerdown", { ...opts, pointerId: 1 }));
    el.dispatchEvent(new PointerEvent("pointerup", { ...opts, pointerId: 1 }));
    // Strategy 2: mouse events
    el.dispatchEvent(new MouseEvent("mousedown", opts));
    el.dispatchEvent(new MouseEvent("mouseup", opts));
    el.dispatchEvent(new MouseEvent("click", opts));
    // Strategy 3: native .click()
    el.click();
  }

  /** Like forceClick but also handles checkbox/radio inputs */
  function forceToggle(el) {
    forceClick(el);
    if (el.tagName === "INPUT" && (el.type === "checkbox" || el.type === "radio")) {
      el.checked = !el.checked;
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  async function ensureMilesToggleOn() {
    // Wait for homepage booking panel to fully render
    for (let waitRound = 0; waitRound < 12; waitRound++) {
      await sleep(1500);
      if (hasMilesToggleEnabled()) {
        console.log("[CX Helper] Book with miles already enabled");
        return true;
      }
      const bodyText = document.body ? document.body.innerText : "";
      if (/Book with miles/.test(bodyText) || /Search flights/.test(bodyText)) {
        console.log("[CX Helper] Booking panel detected on attempt", waitRound);
        break;
      }
      console.log("[CX Helper] Waiting for booking panel... attempt", waitRound);
    }

    if (hasMilesToggleEnabled()) return true;
    console.log("[CX Helper] Book with miles NOT enabled, attempting toggle...");

    // Diagnostic: dump what's near "Book with miles" text so we can debug
    dumpToggleDiagnostics();

    // Strategy 1: Find role="switch" near "Book with miles" text
    const switches = findVisibleElements('[role="switch"], [role="checkbox"]');
    for (const sw of switches) {
      const parent = sw.closest("[class]") || sw.parentElement;
      const nearby = parent ? normalizeText(parent.innerText) : "";
      if (/book with miles/i.test(nearby)) {
        console.log("[CX Helper] S1: Found role=switch near toggle:",
          sw.tagName, sw.getAttribute("aria-checked"));
        forceClick(sw);
        await sleep(1500);
        if (hasMilesToggleEnabled()) {
          console.log("[CX Helper] Book with miles ENABLED via role=switch!");
          return true;
        }
      }
    }

    // Strategy 2: Find input[type=checkbox] inside a label with "Book with miles"
    const checkboxes = findVisibleElements('input[type="checkbox"]');
    for (const cb of checkboxes) {
      const label = cb.closest("label");
      if (label && /book with miles/i.test(normalizeText(label.innerText))) {
        console.log("[CX Helper] S2: Found checkbox in 'Book with miles' label");
        forceToggle(cb);
        await sleep(1500);
        if (hasMilesToggleEnabled()) {
          console.log("[CX Helper] Book with miles ENABLED via checkbox!");
          return true;
        }
      }
    }

    // Strategy 3: Find the smallest element with exact text "Book with miles" and click it
    const allEls = findVisibleElements("span, div, label, p, button");
    const label = allEls.find((el) => normalizeText(el.innerText) === "Book with miles");
    if (label) {
      console.log("[CX Helper] S3: Clicking 'Book with miles' text element:",
        label.tagName, String(label.className || "").slice(0, 60));
      forceClick(label);
      await sleep(1500);
      if (hasMilesToggleEnabled()) {
        console.log("[CX Helper] Book with miles ENABLED via label click!");
        return true;
      }
    }

    // Strategy 4: Find a toggle/switch component near "Book with miles" by looking for
    // common toggle patterns (slider, toggle track, toggle container) ONLY within the
    // immediate parent of the "Book with miles" text element.
    if (label) {
      const toggleParent = label.parentElement;
      if (toggleParent) {
        // Look for sibling elements that look like toggle controls
        const siblings = Array.from(toggleParent.children).filter((c) => c !== label);
        for (const sib of siblings) {
          const rect = sib.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0 && rect.width < 80) {
            console.log("[CX Helper] S4: Clicking toggle sibling:",
              sib.tagName, String(sib.className || "").slice(0, 60));
            forceClick(sib);
            await sleep(1500);
            if (hasMilesToggleEnabled()) {
              console.log("[CX Helper] Book with miles ENABLED via sibling click!");
              return true;
            }
          }
        }
        // Also try clicking the parent itself (the toggle container)
        const parentRect = toggleParent.getBoundingClientRect();
        if (parentRect.width < 300 && parentRect.height < 80) {
          console.log("[CX Helper] S4b: Clicking toggle parent container:",
            toggleParent.tagName, String(toggleParent.className || "").slice(0, 60));
          forceClick(toggleParent);
          await sleep(1500);
          if (hasMilesToggleEnabled()) {
            console.log("[CX Helper] Book with miles ENABLED via parent click!");
            return true;
          }
        }
      }
    }

    // Strategy 5: Find any element with aria-label containing "Book with miles" or "miles"
    const ariaEls = findVisibleElements("[aria-label]");
    for (const el of ariaEls) {
      const ariaLabel = el.getAttribute("aria-label") || "";
      if (/book with miles/i.test(ariaLabel)) {
        console.log("[CX Helper] S5: Found aria-label element:",
          el.tagName, ariaLabel, String(el.className || "").slice(0, 60));
        forceClick(el);
        await sleep(1500);
        if (hasMilesToggleEnabled()) {
          console.log("[CX Helper] Book with miles ENABLED via aria-label!");
          return true;
        }
      }
    }

    // Could not toggle it - proceed anyway so we don't block date setting.
    console.log("[CX Helper] WARNING: Could not enable Book with miles. Proceeding anyway.");
    return true;
  }

  function dumpToggleDiagnostics() {
    try {
      // Find the "Book with miles" text element
      const allEls = findVisibleElements("*");
      const milesEl = allEls.find((el) => {
        const text = normalizeText(el.innerText);
        return text === "Book with miles";
      });
      if (!milesEl) {
        console.log("[CX Helper] DIAG: No element with exact text 'Book with miles' found");
        // Check if text exists anywhere
        const bodyText = document.body ? document.body.innerText : "";
        const idx = bodyText.indexOf("Book with miles");
        console.log("[CX Helper] DIAG: 'Book with miles' in body text at index:", idx);
        return;
      }

      console.log("[CX Helper] DIAG: 'Book with miles' element:",
        milesEl.tagName, "class:", String(milesEl.className || "").slice(0, 80));

      // Walk up 4 parents and log each
      let el = milesEl;
      for (let i = 0; i < 4 && el.parentElement; i++) {
        el = el.parentElement;
        const rect = el.getBoundingClientRect();
        const childTags = Array.from(el.children).map((c) =>
          c.tagName + (c.getAttribute("role") ? "[role=" + c.getAttribute("role") + "]" : "") +
          (c.getAttribute("aria-checked") != null ? "[aria-checked=" + c.getAttribute("aria-checked") + "]" : "") +
          (c.className ? "." + String(c.className).split(" ")[0].slice(0, 30) : "")
        );
        console.log("[CX Helper] DIAG: parent", i + 1, ":", el.tagName,
          "class:", String(el.className || "").slice(0, 60),
          "role:", el.getAttribute("role"),
          "size:", Math.round(rect.width) + "x" + Math.round(rect.height),
          "children:", childTags.join(", "));
      }
    } catch (e) {
      console.log("[CX Helper] DIAG error:", e.message);
    }
  }

  function isActiveCabinTile(el) {
    if (!el) {
      return false;
    }
    const aria = String(el.getAttribute("aria-selected") || el.getAttribute("aria-current") || "");
    const cls = [el.className, el.parentElement && el.parentElement.className].filter(Boolean).join(" ");
    const bg = window.getComputedStyle(el).backgroundColor;
    return aria === "true" ||
      /selected|active|current/i.test(cls) ||
      Boolean(bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent" && bg !== "rgb(255, 255, 255)");
  }

  function findVisibleCabinTiles() {
    const tiles = new Map();
    const candidates = findVisibleElements("button, div, a, span").filter((el) => {
      const text = normalizeText(el.innerText);
      const rect = el.getBoundingClientRect();
      if (!text || text.length > 120) {
        return false;
      }
      if (rect.width < 60 || rect.height < 18 || rect.width > 600 || rect.height > 260) {
        return false;
      }
      if (/View full details|Flight details|Recommended|Direct flights/i.test(text)) {
        return false;
      }
      return CABIN_CODES.some((code) => matchesCabinTileText(text, code));
    });

    for (const el of candidates) {
      const text = normalizeText(el.innerText);
      for (const code of ["PY", "F", "J", "Y"]) {
        const label = getCabinLabel(code);
        if (!matchesCabinTileText(text, code)) {
          continue;
        }
        const rect = el.getBoundingClientRect();
        const area = rect.width * rect.height;
        const existing = tiles.get(code);
        if (!existing || area < existing.area) {
          tiles.set(code, {
            code,
            label,
            el,
            text,
            area,
            active: isActiveCabinTile(el),
          });
        }
      }
    }

    const summary = Array.from(tiles.values()).map((tile) => `${tile.code}:${tile.active ? "active" : "inactive"}:${tile.text.slice(0, 40)}`);
    console.log("[CX Helper] Cabin tile scan:", summary.length ? summary : "none");
    return tiles;
  }

  async function selectCabinOnResults(cabinCode, currentCabinCode) {
    if (!cabinCode) {
      return true;
    }
    if (currentCabinCode === cabinCode) {
      console.log("[CX Helper] Cabin", cabinCode, "already active by state");
      return true;
    }
    const tiles = findVisibleCabinTiles();
    const tileInfo = tiles.get(cabinCode);
    if (!tileInfo || !tileInfo.el) {
      console.log("[CX Helper] Cabin tile not found for", cabinCode);
      return false;
    }
    console.log("[CX Helper] Clicking cabin tile for", cabinCode, "text:", tileInfo.text);
    clickElement(tileInfo.el);
    await sleep(1800);
    if (shouldStop()) {
      return false;
    }
    await waitForFlightCards(12000);
    if (shouldStop()) {
      return false;
    }
    const tilesAfter = findVisibleCabinTiles();
    const switchedTile = tilesAfter.get(cabinCode);
    const previousTile = currentCabinCode ? tilesAfter.get(currentCabinCode) : null;
    if (switchedTile && switchedTile.active) {
      return true;
    }
    if (previousTile && !previousTile.active) {
      return true;
    }
    console.log("[CX Helper] Cabin tile switch for", cabinCode, "did not verify as active; skipping cabin reuse");
    return false;
  }

  function getVisibleCalendarCells() {
    const dayNumbers = new Set(["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "21", "22", "23", "24", "25", "26", "27", "28", "29", "30", "31"]);
    return findVisibleElements("button, a, div").filter((el) => {
      const text = normalizeText(el.innerText);
      if (!text || text.length > 60) {
        return false;
      }
      const lines = text.split(/\s+/);
      return lines.some((part) => dayNumbers.has(part.padStart(2, "0"))) && (/\bNot available\b/i.test(text) || /A\d|HKD|\$\d/.test(text) || /(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/i.test(text));
    });
  }

  function isCalendarStripCellSelected(cell) {
    const aria = cell.getAttribute("aria-selected") || cell.getAttribute("aria-current");
    const cls = String(cell.className || "") + " " + String((cell.parentElement && cell.parentElement.className) || "");
    const bg = window.getComputedStyle(cell).backgroundColor;
    return aria === "true" ||
      /selected|active|current|highlight/i.test(cls) ||
      (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent" && bg !== "rgb(255, 255, 255)");
  }

  function getOrderedStripCells() {
    const bestByDay = new Map();
    for (const cell of getVisibleCalendarCells()) {
      const text = normalizeText(cell.innerText);
      const dayMatch = text.match(/\b(?:MON|TUE|WED|THU|FRI|SAT|SUN)\s+(\d{1,2})\b/i) || text.match(/\b(\d{1,2})\b/);
      if (!dayMatch) {
        continue;
      }
      const day = Number(dayMatch[1]);
      const rect = cell.getBoundingClientRect();
      const area = rect.width * rect.height;
      const existing = bestByDay.get(day);
      if (!existing || area < existing.area) {
        bestByDay.set(day, {
          day,
          cell,
          text,
          area,
          left: rect.left,
          selected: isCalendarStripCellSelected(cell),
        });
      }
    }
    return Array.from(bestByDay.values()).sort((a, b) => a.left - b.left);
  }

  function getVisibleStripSnapshot(baseDateText) {
    const cells = getOrderedStripCells();
    if (!cells.length) {
      return [];
    }
    let selectedIndex = cells.findIndex((entry) => entry.selected);
    const baseDate = baseDateText || getCurrentResultsDate();
    if (selectedIndex === -1 && baseDate) {
      const baseDay = Number(baseDate.slice(8, 10));
      selectedIndex = cells.findIndex((entry) => entry.day === baseDay);
    }
    if (selectedIndex === -1 || !baseDate) {
      return cells.map((entry) => Object.assign({}, entry, {
        date: "",
        unavailable: /Not available/i.test(entry.text),
      }));
    }
    return cells.map((entry, index) => Object.assign({}, entry, {
      date: addDays(baseDate, index - selectedIndex),
      unavailable: /Not available/i.test(entry.text),
    }));
  }

  function findCalendarCellForDay(dayNumber) {
    const twoDigit = String(dayNumber).padStart(2, "0");
    const cells = getVisibleCalendarCells();
    return cells.find((el) => {
      const text = normalizeText(el.innerText);
      return new RegExp(`\\b${Number(twoDigit)}\\b|\\b${twoDigit}\\b`).test(text);
    });
  }

  function findCalendarNextArrow() {
    return findVisibleElements("button, a, div, span").find((el) => {
      const text = normalizeText(el.innerText);
      if (/^>$|^›$|^→$/.test(text)) {
        return true;
      }
      const aria = String(el.getAttribute && (el.getAttribute("aria-label") || el.getAttribute("title")) || "");
      return /next/i.test(aria);
    });
  }

  function findCalendarPrevArrow() {
    return findVisibleElements("button, a, div, span").find((el) => {
      const text = normalizeText(el.innerText);
      if (/^<$|^‹$|^←$/.test(text)) {
        return true;
      }
      const aria = String(el.getAttribute && (el.getAttribute("aria-label") || el.getAttribute("title")) || "");
      return /prev|previous/i.test(aria);
    });
  }

  function parseHumanDate(text) {
    const match = String(text || "").match(/(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/);
    if (!match) {
      return "";
    }
    const monthNames = {
      Jan: "01",
      Feb: "02",
      Mar: "03",
      Apr: "04",
      May: "05",
      Jun: "06",
      Jul: "07",
      Aug: "08",
      Sep: "09",
      Oct: "10",
      Nov: "11",
      Dec: "12",
    };
    const month = monthNames[match[2]];
    if (!month) {
      return "";
    }
    return `${match[3]}-${month}-${String(match[1]).padStart(2, "0")}`;
  }

  function getCurrentResultsDate() {
    const blocks = findVisibleElements("div, span, p, h1, h2, h3");
    for (const el of blocks) {
      const text = normalizeText(el.innerText);
      // Pattern 1: "Departing 30 Nov 2026" all in one element
      if (/^Departing\s+\d{1,2}\s+[A-Za-z]{3}\s+\d{4}$/i.test(text)) {
        return parseHumanDate(text);
      }
      // Pattern 2: "Departing" label with date in parent/sibling
      if (/^Departing$/i.test(text)) {
        // Check parent
        const parentText = normalizeText((el.parentElement && el.parentElement.innerText) || "");
        const parsed = parseHumanDate(parentText);
        if (parsed) return parsed;
        // Check next sibling
        const nextSib = el.nextElementSibling;
        if (nextSib) {
          const sibText = normalizeText(nextSib.innerText);
          const sibParsed = parseHumanDate(sibText);
          if (sibParsed) return sibParsed;
        }
      }
    }
    // Pattern 3: Look for any standalone date like "30 Nov 2026" near the top of the page
    for (const el of blocks) {
      const rect = el.getBoundingClientRect();
      if (rect.top > 200) continue; // Only check top area
      const text = normalizeText(el.innerText);
      if (/^\d{1,2}\s+[A-Za-z]{3}\s+\d{4}$/.test(text)) {
        return parseHumanDate(text);
      }
    }
    return "";
  }

  function getHomepageDepartingDate() {
    const blocks = findVisibleElements("div, span, p");
    for (const el of blocks) {
      const text = normalizeText(el.innerText);
      if (/^Departing on\s+\d{1,2}\s+[A-Za-z]{3}\s+\d{4}$/i.test(text)) {
        return parseHumanDate(text);
      }
      if (/^Departing on$/i.test(text)) {
        const parentText = normalizeText((el.parentElement && el.parentElement.innerText) || "");
        const parsed = parseHumanDate(parentText);
        if (parsed) {
          return parsed;
        }
      }
    }
    return "";
  }

  function findHomepageDateField() {
    const exactButton = findVisibleElements("button").find((el) => {
      return /\bc-date-picker__range-base\b/.test(el.className || "") && /Departing on/i.test(normalizeText(el.innerText));
    });
    if (exactButton) {
      return exactButton;
    }
    const candidates = findVisibleElements("div, button, label, section").filter((el) => {
      const text = normalizeText(el.innerText);
      return (
        /Departing on/i.test(text) &&
        (/Select a departure date/i.test(text) || /^\d{1,2}\s+[A-Za-z]{3}\s+\d{4}$/.test(text) || /\d{1,2}\s+[A-Za-z]{3}\s+\d{4}/.test(text))
      );
    });
    if (!candidates.length) {
      return null;
    }
    candidates.sort((a, b) => {
      const rectA = a.getBoundingClientRect();
      const rectB = b.getBoundingClientRect();
      return rectB.width * rectB.height - rectA.width * rectA.height;
    });
    return candidates[0];
  }

  function hasNoAvailabilityModalText(text) {
    return /There are no available flights for that date/i.test(String(text || "")) ||
      /There are no flights available for the date and\/or award type you have selected/i.test(String(text || ""));
  }

  function findNoAvailabilityModalCloseButton() {
    const exactClose = findVisibleElements("button, a, div, span").find((el) => /^Close$/i.test(normalizeText(el.innerText)));
    if (exactClose) {
      return exactClose;
    }
    return findVisibleElements("button, a, div, span").find((el) => {
      const text = normalizeText(el.innerText);
      const aria = String(el.getAttribute("aria-label") || el.getAttribute("title") || "");
      return /^×$|^x$/i.test(text) || /close/i.test(aria);
    });
  }

  async function dismissNoAvailabilityModalIfPresent() {
    const bodyText = document.body ? document.body.innerText : "";
    if (!hasNoAvailabilityModalText(bodyText)) {
      return false;
    }
    const closeBtn = findNoAvailabilityModalCloseButton();
    console.log("[CX Helper] No-availability modal detected");
    if (!closeBtn) {
      console.log("[CX Helper] No-availability modal close button not found");
      return false;
    }
    console.log("[CX Helper] Closing no-availability modal via", closeBtn.tagName, normalizeText(closeBtn.innerText) || (closeBtn.getAttribute("aria-label") || ""));
    clickElement(closeBtn);
    await sleep(1200);
    return true;
  }

  function formatMonthLabel(dateText) {
    const date = new Date(`${dateText}T00:00:00`);
    return date.toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
    });
  }

  /**
   * Get visible month header texts from the two-month calendar popup.
   * Returns an array like ["March 2026", "April 2026"].
   */
  function getVisibleCalendarMonthHeaders() {
    return findVisibleElements("div, span, h2, h3, caption")
      .map((el) => normalizeText(el.innerText))
      .filter((text) => /^[A-Z][a-z]+ \d{4}$/.test(text));
  }

  /**
   * Find the next-month arrow button in the calendar.
   * From the screenshot: it's a ">" character on the right side of the calendar header row,
   * next to the second month name (e.g. "April 2026  >").
   */
  function findCalendarNextButton() {
    const candidates = findVisibleElements("button, a, span, div, i");

    // Strategy 1: aria-label with "next"
    for (const el of candidates) {
      const aria = String(el.getAttribute("aria-label") || el.getAttribute("title") || "");
      if (/next/i.test(aria) && !/previous/i.test(aria)) {
        console.log("[CX Helper] Next button found via aria-label:", el.tagName, el.className, aria);
        return el;
      }
    }

    // Strategy 2: exact text ">" or similar chevron characters
    for (const el of candidates) {
      const text = normalizeText(el.innerText);
      if (/^[>›→❯⟩]$/.test(text)) {
        console.log("[CX Helper] Next button found via text '>':", el.tagName, el.className);
        return el;
      }
    }

    // Strategy 3: Small clickable element near the right edge of a month header area
    // Find the rightmost month header, then look for a clickable sibling nearby
    const monthHeaders = findVisibleElements("div, span, h2, h3, caption").filter((el) => {
      return /^[A-Z][a-z]+ \d{4}$/.test(normalizeText(el.innerText));
    });
    if (monthHeaders.length > 0) {
      // Get the rightmost month header
      const rightHeader = monthHeaders.reduce((a, b) =>
        a.getBoundingClientRect().right > b.getBoundingClientRect().right ? a : b
      );
      const headerRect = rightHeader.getBoundingClientRect();

      // Look for a small clickable element to the right of this header
      for (const el of candidates) {
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        if (rect.width > 60 || rect.height > 60) continue;
        // Must be to the right of the month header and roughly at the same vertical position
        if (rect.left > headerRect.right - 10 &&
            Math.abs(rect.top - headerRect.top) < 30) {
          // Check it has an SVG, icon, or the chevron character
          const hasIcon = el.querySelector("svg, i, [class*='icon'], [class*='arrow'], [class*='chevron']");
          const text = normalizeText(el.innerText);
          if (hasIcon || /^[>›→❯⟩]$/.test(text) || text === "") {
            console.log("[CX Helper] Next button found via position:", el.tagName, el.className, "text:", JSON.stringify(text));
            return el;
          }
        }
      }

      // Strategy 4: Check the parent/ancestor of the month header for a next button
      let headerParent = rightHeader.parentElement;
      for (let depth = 0; depth < 4 && headerParent; depth++) {
        const btns = Array.from(headerParent.querySelectorAll("button, a, [role='button']")).filter((el) => {
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && rect.width < 60;
        });
        // Take the rightmost small button in the header area
        if (btns.length > 0) {
          const rightBtn = btns.reduce((a, b) =>
            a.getBoundingClientRect().left > b.getBoundingClientRect().left ? a : b
          );
          console.log("[CX Helper] Next button found via header ancestor:", rightBtn.tagName, rightBtn.className, "text:", JSON.stringify(normalizeText(rightBtn.innerText)));
          return rightBtn;
        }
        headerParent = headerParent.parentElement;
      }
    }

    console.log("[CX Helper] Could not find next button at all");
    return null;
  }

  /**
   * Find a month panel within the two-month calendar view by its header text.
   * The calendar shows two months side by side. Each month has a header like
   * "March 2026" and a grid of day cells below it.
   */
  function findMonthPanel(monthLabel) {
    // Find all visible elements whose text is exactly the month label
    const headers = findVisibleElements("div, span, h2, h3, caption").filter((el) => {
      return normalizeText(el.innerText) === monthLabel;
    });

    for (const header of headers) {
      // Walk up from the header to find the container with both header and day grid
      let container = header.parentElement;
      for (let depth = 0; depth < 8 && container; depth++) {
        // Check if this container has day cells (td elements with numbers)
        const hasDayCells = container.querySelector("td, [class*='calendar__cell'], [class*='dayPicker']");
        if (hasDayCells) {
          // Make sure this container's text includes the month label (not a parent of both months)
          const containerText = normalizeText(container.innerText);
          // Avoid selecting the entire two-month wrapper (it would contain both month labels)
          const allMonths = getVisibleCalendarMonthHeaders();
          const containsMultipleMonths = allMonths.filter((m) => containerText.includes(m)).length > 1;
          if (!containsMultipleMonths) {
            return container;
          }
        }
        container = container.parentElement;
      }
    }
    return null;
  }

  /**
   * Find a clickable day cell within a month panel.
   * The day number appears as text like "1", "15", "31" inside td or button elements.
   * Excludes disabled/other-month cells to avoid clicking day "1" in the wrong month.
   */
  function findDayCell(dayNumber, scopeEl) {
    const exact = String(Number(dayNumber));
    const root = scopeEl || document;

    // Look for td cells or specific calendar cell elements containing the exact day number
    const candidates = Array.from(root.querySelectorAll("td, button, div, span")).filter((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      // Day cells are typically smallish (a single grid cell)
      if (rect.width > 100 || rect.height > 100) return false;
      const text = normalizeText(el.innerText);
      // Match exact day number - the cell text might be just "6" or might include
      // a small icon/indicator, so check if the text starts with or equals the day
      if (text !== exact && !text.startsWith(exact + " ")) return false;

      // Exclude disabled / other-month cells
      const cl = String(el.className || "");
      const parentCl = String((el.parentElement && el.parentElement.className) || "");
      const allCl = cl + " " + parentCl;
      if (/disabled|outside|other-month|inactive|prev-month|next-month|muted|faded/i.test(allCl)) return false;
      // Also check aria-disabled
      if (el.getAttribute("aria-disabled") === "true") return false;
      // Check opacity - other-month days are often dimmed
      const style = window.getComputedStyle(el);
      if (parseFloat(style.opacity) < 0.5) return false;

      return true;
    });

    if (candidates.length === 0) return null;

    // Prefer the most specific (smallest/innermost) element
    candidates.sort((a, b) => {
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      return (ra.width * ra.height) - (rb.width * rb.height);
    });

    console.log("[CX Helper] findDayCell found", candidates.length, "candidates for day", exact,
      "picking:", candidates[0].tagName, candidates[0].className, "text:", normalizeText(candidates[0].innerText));
    return candidates[0];
  }

  /**
   * Navigate the two-month calendar to show the target month, then click the target day.
   * The calendar shows two months at a time with a ">" arrow to go forward.
   */
  async function setHomepageDepartingDate(targetDate) {
    const currentDate = getHomepageDepartingDate();
    if (currentDate === targetDate) {
      return true;
    }

    // Click the date field to open the calendar popup
    const dateField = findHomepageDateField();
    if (!dateField) {
      console.log("[CX Helper] Could not find homepage date field");
      return false;
    }
    clickElement(dateField);
    await sleep(1200);

    // Wait for calendar month headers to appear
    let headers = [];
    for (let wait = 0; wait < 10; wait++) {
      headers = getVisibleCalendarMonthHeaders();
      if (headers.length > 0) break;
      await sleep(500);
    }
    if (headers.length === 0) {
      console.log("[CX Helper] No calendar month headers appeared after clicking date field");
      return false;
    }
    console.log("[CX Helper] Calendar opened, visible months:", headers);

    const targetMonthLabel = formatMonthLabel(targetDate);
    const targetDay = targetDate.slice(8, 10);

    // Navigate forward until the target month is visible (max ~12 clicks for a year out)
    for (let clicks = 0; clicks < 18; clicks++) {
      const visibleMonths = getVisibleCalendarMonthHeaders();
      console.log("[CX Helper] Visible months:", visibleMonths, "Looking for:", targetMonthLabel);

      if (visibleMonths.includes(targetMonthLabel)) {
        // Target month is visible! Find its panel and click the day.
        await sleep(300);
        const monthPanel = findMonthPanel(targetMonthLabel);
        if (!monthPanel) {
          // If we can't isolate the panel, try finding the day cell in the whole document
          console.log("[CX Helper] Could not isolate month panel, trying document-wide search");
          const dayCell = findDayCell(targetDay, document);
          if (dayCell) {
            clickElement(dayCell);
            await sleep(800);
            const result = getHomepageDepartingDate();
            console.log("[CX Helper] After clicking day (doc-wide), date field shows:", result);
            return result === targetDate;
          }
          return false;
        }

        const dayCell = findDayCell(targetDay, monthPanel);
        if (!dayCell) {
          console.log("[CX Helper] Found month panel but could not find day", targetDay);
          console.log("[CX Helper] Panel text:", normalizeText(monthPanel.innerText).slice(0, 300));
          return false;
        }

        console.log("[CX Helper] Clicking day cell for", targetMonthLabel, "day", targetDay);
        clickElement(dayCell);
        await sleep(1000);

        // Check if date was set. For one-way trips, a single click should suffice.
        let result = getHomepageDepartingDate();
        console.log("[CX Helper] After day click, date field reads:", result, "expected:", targetDate);

        // If the wrong date was set (e.g. clicked Nov 30 instead of Dec 1), detect and retry
        if (result && result !== targetDate) {
          console.log("[CX Helper] Wrong date set! Got", result, "instead of", targetDate, "- will retry");
          // Re-open the calendar and try again
          clickElement(dateField);
          await sleep(1000);
          // Navigate to the right month again (it might have reset)
          continue;
        }

        if (result === targetDate) {
          console.log("[CX Helper] Date successfully set to", targetDate);
          return true;
        }

        // The calendar might still be open expecting a return date click.
        // Since this is one-way, look for a "Done" / "Confirm" button.
        const confirmBtn = findVisibleElements("button").find((el) => {
          const text = normalizeText(el.innerText);
          return /^(Done|Confirm|Apply|OK|Select)$/i.test(text);
        });
        if (confirmBtn) {
          clickElement(confirmBtn);
          await sleep(600);
          result = getHomepageDepartingDate();
          if (result === targetDate) return true;
        }

        // If still not set, the field text might not update until calendar closes.
        // Try clicking outside the calendar to close it.
        const bookingPanel = findVisibleElements("div").find((el) =>
          /Book a trip/i.test(normalizeText(el.innerText)) && el.getBoundingClientRect().width > 400
        );
        if (bookingPanel) {
          bookingPanel.click();
          await sleep(600);
          result = getHomepageDepartingDate();
          if (result === targetDate) return true;
        }

        console.log("[CX Helper] Clicked day but date field shows:", result, "expected:", targetDate);
        // Accept if any date was set (field changed from "Select a departure date")
        return result !== "" && result === targetDate;
      }

      // Target month not visible yet - click the next arrow
      const beforeMonths = visibleMonths.join(", ");
      const nextBtn = findCalendarNextButton();
      if (!nextBtn) {
        console.log("[CX Helper] Could not find calendar next arrow to navigate forward");
        return false;
      }
      // Log details about what we're clicking
      const btnRect = nextBtn.getBoundingClientRect();
      console.log("[CX Helper] Clicking next button:", nextBtn.tagName, nextBtn.className,
        "outerHTML:", nextBtn.outerHTML.slice(0, 200),
        "rect:", Math.round(btnRect.left), Math.round(btnRect.top), Math.round(btnRect.width), "x", Math.round(btnRect.height));
      clickElement(nextBtn);
      await sleep(800);
      const afterMonths = getVisibleCalendarMonthHeaders().join(", ");
      if (afterMonths === beforeMonths) {
        console.log("[CX Helper] WARNING: Months did not change after clicking next! Before:", beforeMonths, "After:", afterMonths);
        // Try clicking the element directly with .click()
        nextBtn.click();
        await sleep(800);
        const afterRetry = getVisibleCalendarMonthHeaders().join(", ");
        if (afterRetry === beforeMonths) {
          console.log("[CX Helper] Still no change after direct .click(). Aborting.");
          return false;
        }
      }
    }

    console.log("[CX Helper] Exhausted navigation attempts, target month not reached");
    return false;
  }

  async function ensureCalendarCellVisible(targetDate, currentDate) {
    const targetDay = Number(targetDate.slice(8, 10));
    for (let tries = 0; tries < 6; tries += 1) {
      const cell = findCalendarCellForDay(targetDay);
      if (cell) {
        return cell;
      }
      let arrow = null;
      if (currentDate) {
        arrow = targetDate < currentDate ? findCalendarPrevArrow() : findCalendarNextArrow();
      } else {
        arrow = findCalendarNextArrow();
      }
      if (!arrow) {
        return null;
      }
      clickElement(arrow);
      await sleep(1200);
      currentDate = getCurrentResultsDate() || currentDate;
    }
    return null;
  }

  /**
   * Parse flight cards from the results page using TWO strategies:
   * Strategy A: DOM-based - find individual card elements
   * Strategy B: Text-based - parse the full page text for flight patterns
   * Returns whichever strategy finds more results.
   */
  function parseVisibleItineraries() {
    const hitsA = parseFlightsFromDOM();
    const hitsB = parseFlightsFromPageText();
    const milesA = hitsA.filter((h) => h.miles).length;
    const milesB = hitsB.filter((h) => h.miles).length;
    console.log("[CX Helper] DOM strategy:", hitsA.length, "flights (" + milesA + " with miles).",
      "Text strategy:", hitsB.length, "flights (" + milesB + " with miles).");
    // Prefer the strategy that found more miles; tie-break by flight count
    if (milesA > milesB) return hitsA;
    if (milesB > milesA) return hitsB;
    return hitsA.length >= hitsB.length ? hitsA : hitsB;
  }

  function extractFallbackMilesFromVisibleResults() {
    const stripCells = getOrderedStripCells();
    const selectedCell = stripCells.find((entry) => entry.selected);
    const selectedText = normalizeText(selectedCell ? selectedCell.text : "");
    const selectedMatch = selectedText.match(/(\d{2,3}[,.]?\d{3})/);
    if (selectedMatch) {
      return Number(selectedMatch[1].replace(/[,.]/g, "")).toLocaleString();
    }

    for (const tile of findVisibleCabinTiles().values()) {
      const text = normalizeText(tile && tile.text);
      const match = text.match(/(\d{2,3}[,.]?\d{3})/);
      if (match) {
        return Number(match[1].replace(/[,.]/g, "")).toLocaleString();
      }
    }
    return "";
  }

  function applyFallbackMiles(itineraries) {
    if (!Array.isArray(itineraries) || !itineraries.length) {
      return itineraries;
    }
    if (itineraries.some((item) => item.miles)) {
      return itineraries;
    }
    const fallbackMiles = extractFallbackMilesFromVisibleResults();
    if (!fallbackMiles) {
      return itineraries;
    }
    console.log("[CX Helper] Applying fallback miles from visible results:", fallbackMiles);
    return itineraries.map((item) => Object.assign({}, item, { miles: fallbackMiles }));
  }

  function hasNoRedemptionSeatsText(text) {
    return /There are no redemption seats available for this flight/i.test(String(text || ""));
  }

  /** Strategy A: Find flight cards in the DOM */
  function parseFlightsFromDOM() {
    const allDivs = findVisibleElements("div, article, section, li");
    const flightRelated = allDivs.filter((el) => {
      const text = normalizeText(el.innerText);
      if (text.length <= 15 || text.length > 1500) return false;
      if (!/\bCX\d{2,4}\b/.test(text)) return false;
      // Filter out giant containers — individual flight cards should be < 800px wide/tall
      const rect = el.getBoundingClientRect();
      if (rect.width > 800 || rect.height > 800) return false;
      return true;
    });
    console.log("[CX Helper] DOM: Elements with CX numbers:", flightRelated.length);
    for (let i = 0; i < Math.min(3, flightRelated.length); i++) {
      const t = normalizeText(flightRelated[i].innerText);
      const r = flightRelated[i].getBoundingClientRect();
      console.log("[CX Helper] DOM Card", i, "size:", Math.round(r.width) + "x" + Math.round(r.height),
        "text:", JSON.stringify(t.slice(0, 300)));
    }

    const hits = [];
    const seen = new Set();
    const candidates = flightRelated.slice().sort((a, b) => {
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      return (ra.width * ra.height) - (rb.width * rb.height);
    });

    for (const el of candidates) {
      const text = normalizeText(el.innerText);
      const flightNumbers = text.match(/\bCX\d{2,4}\b/g) || [];
      const uniqueFlights = [...new Set(flightNumbers)];
      if (uniqueFlights.length !== 1) continue;
      const flight = uniqueFlights[0];
      if (seen.has(flight)) continue;
      const times = text.match(/\d{1,2}:\d{2}/g) || [];
      if (times.length === 0) continue;
      if (hasNoRedemptionSeatsText(text)) continue;
      const stopMatch = text.match(/(\d+)\s+stop/i);
      if (stopMatch && Number(stopMatch[1]) > 0) continue;
      seen.add(flight);
      hits.push(extractFlightDetails(flight, text));
    }
    return hits;
  }

  /** Strategy B: Parse the entire page text for flight patterns */
  function parseFlightsFromPageText() {
    const bodyText = document.body ? document.body.innerText : "";
    console.log("[CX Helper] Text: Full page text length:", bodyText.length);

    // Find all CX flight numbers in the page
    const cxPattern = /\bCX\d{2,4}\b/g;
    const allCX = [];
    let m;
    while ((m = cxPattern.exec(bodyText)) !== null) {
      allCX.push({ flight: m[0], index: m.index });
    }
    console.log("[CX Helper] Text: Found CX numbers:", allCX.map((c) => c.flight));

    // Group by flight number - use the LAST occurrence of each (most likely the
    // actual flight card, not header metadata)
    const lastOccurrence = new Map();
    for (const cx of allCX) {
      lastOccurrence.set(cx.flight, cx);
    }

    const hits = [];
    for (const [flight, cx] of lastOccurrence) {
      // Extract a wide window around this flight number (800 chars after to reach miles)
      const win = bodyText.slice(Math.max(0, cx.index - 50), cx.index + 800);
      const windowNorm = normalizeText(win);

      // Check if this is a connecting flight (has "stop" nearby)
      if (/\d+\s+stop/i.test(windowNorm)) continue;
      if (hasNoRedemptionSeatsText(windowNorm)) continue;

      // Must have time patterns nearby
      const times = windowNorm.match(/\d{1,2}:\d{2}/g) || [];
      if (times.length === 0) continue;

      console.log("[CX Helper] Text: Extracting", flight, "from:", JSON.stringify(windowNorm.slice(0, 300)));
      hits.push(extractFlightDetails(flight, windowNorm));
    }
    return hits;
  }

  /** Extract departure, arrival, duration, miles from a text block */
  function extractFlightDetails(flight, text) {
    const times = text.match(/\d{1,2}:\d{2}/g) || [];
    const depart = times[0] || "";
    const arrive = times[1] || "";
    const arriveNextDay = /\d{1,2}:\d{2}\s*\+\s*\d/.test(text);
    const arriveDisplay = arrive + (arriveNextDay ? "+1" : "");
    const durationMatch = text.match(/(\d{1,2}h\s*\d{1,2}m)/);
    const duration = durationMatch ? durationMatch[1] : "";

    // Extract miles - look for Asia Miles format "A75,000" first, then generic numbers
    let miles = "";

    // Priority 1: "A" prefix miles (e.g. "A75,000" or "A 75,000")
    const asiaMilesMatch = text.match(/A\s*(\d{2,3}[,.]?\d{3})/g);
    if (asiaMilesMatch) {
      for (const am of asiaMilesMatch) {
        const numStr = am.replace(/[^0-9]/g, "");
        const num = Number(numStr);
        if (num >= 10000 && num <= 999000) {
          miles = numStr;
          break;
        }
      }
    }

    // Priority 2: Generic large numbers (fallback)
    if (!miles) {
      const milesMatch = text.match(/(\d{2,3}[,.]?\d{3})/g);
      if (milesMatch) {
        const mileCandidates = milesMatch.filter((m) => {
          const num = Number(m.replace(/[,.]/g, ""));
          return num >= 10000 && num <= 999000;
        });
        if (mileCandidates.length > 0) {
          miles = mileCandidates[mileCandidates.length - 1].replace(/[,.]/g, "");
        }
      }
    }

    console.log("[CX Helper] Parsed:", flight, depart, "→", arriveDisplay, duration, miles ? miles + " miles" : "NO MILES");
    return {
      flight,
      depart,
      arrive: arriveDisplay,
      duration,
      miles: miles ? Number(miles).toLocaleString() : "",
    };
  }

  function hasExplicitNoFlightsMessage() {
    const text = document.body ? document.body.innerText : "";
    if (/No flights available/i.test(text) ||
      /no available flights/i.test(text) ||
      hasNoAvailabilityModalText(text) ||
      /There are no redemption seats available for this flight/i.test(text) ||
      /no results found/i.test(text) ||
      /Sorry, there are no/i.test(text)) return true;
    return false;
  }

  /** Check if the currently selected strip cell says "Not available" */
  function isSelectedDateNotAvailable() {
    const cells = getOrderedStripCells();
    for (const cell of cells) {
      if (cell.selected && /not available/i.test(cell.text)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Wait for flight cards to appear on the results page.
   * Returns true if cards appeared, false if timed out.
   */
  function isPageLoading() {
    // Check for specific loading indicators (not too broad)
    const spinners = document.querySelectorAll(
      '[role="progressbar"], [aria-busy="true"]'
    );
    for (const s of spinners) {
      const rect = s.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) return true;
    }
    // Check for "Loading" text in the main content area
    const bodyText = document.body ? document.body.innerText : "";
    if (/Loading flights/i.test(bodyText) || /Searching for flights/i.test(bodyText)) return true;
    return false;
  }

  async function waitForFlightCards(maxWaitMs) {
    const totalWait = maxWaitMs || 15000;
    // Wait at least 3 seconds before even checking - give the page time to render
    const minWaitMs = Math.min(3000, totalWait);
    console.log("[CX Helper] waitForFlightCards: waiting", minWaitMs, "ms minimum, up to", totalWait, "ms total");
    await sleep(minWaitMs);

    const deadline = Date.now() + (totalWait - minWaitMs);
    let foundOnce = false;
    while (Date.now() < deadline) {
      if (shouldStop()) {
        console.log("[CX Helper] waitForFlightCards aborted because run stopped");
        return false;
      }
      // Check if any CX flight numbers with times are visible
      // Use full body text as primary check (more reliable than individual element scanning)
      const bodyText = document.body ? document.body.innerText : "";
      const hasFlights = /\bCX\d{2,4}\b/.test(bodyText) && /\d{1,2}:\d{2}/.test(bodyText) &&
        /Flight details/i.test(bodyText);

      if (hasFlights) {
        if (!foundOnce) {
          console.log("[CX Helper] Flight cards appearing, waiting 2s for stabilization...");
          foundOnce = true;
          await sleep(2000);
          continue;
        }
        console.log("[CX Helper] Flight cards stable and ready");
        return true;
      }

      // Only check for "no flights" messages AFTER we've waited a reasonable amount
      // (don't check immediately - the page might show these briefly during loading)
      if (Date.now() > deadline - (totalWait - minWaitMs - 5000)) {
        // We've waited at least 5+ seconds total, safe to check for "no flights"
        if (hasExplicitNoFlightsMessage()) {
          console.log("[CX Helper] 'No flights available' message detected");
          return true;
        }
        if (isSelectedDateNotAvailable()) {
          console.log("[CX Helper] Selected date shows 'Not available' in strip");
          return true;
        }
      }

      await sleep(1000);
    }
    console.log("[CX Helper] Timed out waiting for flight cards after", totalWait, "ms");
    return false;
  }

  function buildUnavailableResult(dateText, cabinCode) {
    return {
      date: dateText,
      cabinCode,
      cabin: getCabinLabel(cabinCode),
      itineraries: [],
      available: false,
    };
  }

  async function inspectCurrentResults(run, dateText, cabinCode) {
    const noAvail = buildUnavailableResult(dateText, cabinCode);

    // Wait for flight cards to render after page load / date change
    await waitForFlightCards(15000);
    if (shouldStop()) {
      return noAvail;
    }

    if (await dismissNoAvailabilityModalIfPresent()) {
      console.log("[CX Helper] Dismissed no-availability modal for", dateText, cabinCode);
      return noAvail;
    }

    // If the selected date says "Not available" in the strip, skip immediately
    if (isSelectedDateNotAvailable()) {
      console.log("[CX Helper] Date", dateText, "is 'Not available' per strip");
      return noAvail;
    }

    // Try to enable Direct flights filter, but don't let it block extraction.
    // The parser already skips connecting flights via the "stop" check.
    if (run.directOnly) {
      try {
        await ensureDirectFlightsEnabled();
        await sleep(2000);
      } catch (e) {
        console.log("[CX Helper] ensureDirectFlightsEnabled error (non-fatal):", e.message);
      }
    }

    // Don't check cabin - it's already set from homepage search.
    // Don't check for "no flights" message here - just go straight to extraction.

    const itineraries = applyFallbackMiles(parseVisibleItineraries());
    if (itineraries.length === 0) {
      // Extra diagnostics: dump the page text around CX references
      const allText = document.body ? document.body.innerText : "";
      const cxMatches = allText.match(/.{0,80}CX\d{2,4}.{0,80}/g) || [];
      console.log("[CX Helper] No itineraries parsed. CX text found on page:", cxMatches.length);
      for (let i = 0; i < Math.min(5, cxMatches.length); i++) {
        console.log("[CX Helper] CX context " + i + ":", JSON.stringify(cxMatches[i].trim()));
      }
      console.log("[CX Helper] isPageLoading:", isPageLoading(),
        "noFlightsMsg:", hasExplicitNoFlightsMessage());
      return noAvail;
    }

    return {
      date: dateText,
      cabinCode,
      cabin: getCabinLabel(cabinCode),
      itineraries,
      available: true,
    };
  }

  function getResultKey(result) {
    return `${result.date}__${result.cabinCode || ""}`;
  }

  function hasRunResult(run, dateText, cabinCode) {
    return (run.results || []).some((item) => item.date === dateText && item.cabinCode === cabinCode);
  }

  function upsertRunResult(run, result) {
    const next = (run.results || []).filter((item) => getResultKey(item) !== getResultKey(result));
    next.push(result);
    next.sort((a, b) => {
      const dateCompare = a.date.localeCompare(b.date);
      if (dateCompare !== 0) {
        return dateCompare;
      }
      return cabinSortValue(a.cabinCode) - cabinSortValue(b.cabinCode);
    });
    run.results = next;
    if (run && run.errorRecoveries && result && result.date && result.cabinCode) {
      delete run.errorRecoveries[`${result.date}__${result.cabinCode}`];
    }
  }

  function findNextPendingSeed(run) {
    const cabins = getRunCabinCodes(run);
    for (let offset = 0; offset < run.days; offset += 1) {
      const dateText = addDays(run.startDate, offset);
      for (const cabinCode of cabins) {
        if (!hasRunResult(run, dateText, cabinCode)) {
          return { offset, dateText, cabinCode };
        }
      }
    }
    return null;
  }

  function hasFinishedAllResults(run) {
    return !findNextPendingSeed(run);
  }

  function renderResults() {
    const tbody = document.querySelector(`#${PANEL_ID} tbody`);
    if (!tbody) {
      return;
    }
    const run = loadRun();
    state.results = run && Array.isArray(run.results) ? run.results : [];
    tbody.innerHTML = "";
    for (const row of state.results) {
      if (!row.available || !row.itineraries || row.itineraries.length === 0) {
        // No availability - show single row
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${row.date}</td>
          <td>${row.cabin || ""}</td>
          <td colspan="4" style="color:#9fb6b0;">No direct flights</td>
        `;
        tbody.appendChild(tr);
        continue;
      }
      // One row per flight on this date
      for (let i = 0; i < row.itineraries.length; i++) {
        const it = row.itineraries[i];
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${i === 0 ? row.date : ""}</td>
          <td>${i === 0 ? row.cabin : ""}</td>
          <td>${it.flight}</td>
          <td>${it.depart}${it.arrive ? " – " + it.arrive : ""}</td>
          <td>${it.duration}</td>
          <td>${it.miles ? "A" + it.miles : ""}</td>
        `;
        tbody.appendChild(tr);
      }
    }
  }

  async function goToTargetDate(targetDate) {
    const targetDay = Number(targetDate.slice(8, 10));
    const currentDate = getCurrentResultsDate();
    const cell = await ensureCalendarCellVisible(targetDate, currentDate);
    if (!cell) {
      return { found: false, unavailable: false };
    }
    const text = normalizeText(cell.innerText);
    if (!new RegExp(`\\b${targetDay}\\b`).test(text)) {
      return { found: false, unavailable: false };
    }
    if (/Not available/i.test(text)) {
      return { found: true, unavailable: true };
    }
    clickElement(cell);
    await sleep(1800);
    return { found: true, unavailable: false };
  }

  /**
   * Find the strip cell element for a given day number.
   * Returns { cell, text } or null.
   */
  function findStripCellForDay(targetDay) {
    const allCells = getOrderedStripCells();
    const found = allCells.find((entry) => entry.day === targetDay);
    return found ? { cell: found.cell, text: found.text } : null;
  }

  /**
   * On the results page, ensure the correct date is selected in the horizontal
   * calendar strip. Always clicks the target day cell to be sure.
   * Returns "ok", "unavailable", or "failed".
   */
  async function ensureResultsDateSelected(targetDate) {
    const targetDay = Number(targetDate.slice(8, 10));
    const targetMonth = Number(targetDate.slice(5, 7)); // 1-12

    console.log("[CX Helper] ensureResultsDateSelected: target=", targetDate,
      "day=", targetDay, "month=", targetMonth);

    // Log what the strip currently shows
    const allCells = getVisibleCalendarCells();
    console.log("[CX Helper] Strip cells:", allCells.length,
      allCells.map((c) => normalizeText(c.innerText).slice(0, 30)));

    // Also log the header date
    const headerDate = getCurrentResultsDate();
    console.log("[CX Helper] Results header date:", headerDate);

    // Find the target day cell in the strip
    let found = findStripCellForDay(targetDay);

    if (!found) {
      // Day not visible - try navigating with arrows
      console.log("[CX Helper] Day", targetDay, "not in visible strip, navigating with arrows...");
      const nav = await goToTargetDate(targetDate);
      if (nav.found && nav.unavailable) return "unavailable";
      if (nav.found) {
        await sleep(2000);
        return "ok";
      }
      return "failed";
    }

    console.log("[CX Helper] Found strip cell for day", targetDay, ":", found.text);

    // Check if "Not available"
    if (/Not available/i.test(found.text)) {
      console.log("[CX Helper] Day", targetDay, "shows 'Not available' in strip");
      return "unavailable";
    }

    // ALWAYS click the target day cell to make sure it's selected.
    // Don't rely on heuristics about whether it's "already selected" -
    // just click it. This is safe because clicking an already-selected day is a no-op.
    console.log("[CX Helper] Clicking strip day", targetDay);
    forceClick(found.cell);
    await sleep(2000);
    if (shouldStop()) {
      return "failed";
    }

    // Also try clicking the inner button/link if the cell is a container
    const inner = found.cell.querySelector("button, a, [role='button']");
    if (inner) {
      console.log("[CX Helper] Also clicking inner element:", inner.tagName);
      forceClick(inner);
      await sleep(1000);
      if (shouldStop()) {
        return "failed";
      }
    }

    // Wait for flight content to load/update after clicking the day
    await waitForFlightCards(12000);
    return "ok";
  }

  /** Wait for the results page to be fully loaded (calendar strip + content area) */
  async function waitForResultsPageReady(maxWaitMs) {
    // ALWAYS wait a minimum of 5 seconds before checking anything.
    // The results page needs time to start rendering after navigation.
    console.log("[CX Helper] Waiting 5s for results page to begin rendering...");
    await sleep(5000);

    const deadline = Date.now() + (maxWaitMs || 20000);
    while (Date.now() < deadline) {
      if (shouldStop()) {
        console.log("[CX Helper] waitForResultsPageReady aborted because run stopped");
        return false;
      }
      // Check if the calendar strip is rendered (has day cells with day numbers)
      const cells = getVisibleCalendarCells();
      const hasDayCells = cells.some((c) => /\b\d{1,2}\b/.test(normalizeText(c.innerText)));
      if (hasDayCells) {
        // Check for actual flight content (not just nav text)
        const bodyText = document.body ? document.body.innerText : "";
        const hasFlightContent = /\bCX\d{2,4}\b/.test(bodyText) ||
          /Flight details/i.test(bodyText);
        const hasNoFlightContent = /Not available/i.test(bodyText) ||
          /No flights available/i.test(bodyText);
        if (hasFlightContent || hasNoFlightContent) {
          console.log("[CX Helper] Results page ready: strip has", cells.length, "cells, flight content detected");
          await sleep(2000); // extra stabilization
          return true;
        }
      }
      console.log("[CX Helper] Waiting for results page to render... strip cells:", cells.length);
      await sleep(1500);
    }
    // Even if we timed out, the page might still be usable - return true so we try extraction
    console.log("[CX Helper] Results page wait timed out, proceeding anyway");
    return true;
  }

  function saveRunAndRender(run) {
    saveRun(run);
    renderResults();
  }

  function hasCompletedCabinRange(run, cabinCode) {
    for (let offset = 0; offset < run.days; offset += 1) {
      const dateText = addDays(run.startDate, offset);
      if (!hasRunResult(run, dateText, cabinCode)) {
        return false;
      }
    }
    return true;
  }

  function markVisibleUnavailableDates(run, cabinCode, baseDateText) {
    const snapshot = getVisibleStripSnapshot(baseDateText);
    let added = 0;
    for (const entry of snapshot) {
      if (!entry.date || !isDateWithinRun(run, entry.date) || !entry.unavailable) {
        continue;
      }
      if (hasRunResult(run, entry.date, cabinCode)) {
        continue;
      }
      console.log("[CX Helper] Marking strip date as unavailable:", entry.date, cabinCode, entry.text);
      upsertRunResult(run, buildUnavailableResult(entry.date, cabinCode));
      added += 1;
    }
    if (added > 0) {
      saveRunAndRender(run);
    }
    return snapshot;
  }

  async function clickStripSnapshotEntry(entry, run) {
    console.log("[CX Helper] Clicking strip entry for", entry.date, "text:", entry.text);
    forceClick(entry.cell);
    const inner = entry.cell.querySelector("button, a, [role='button']");
    if (inner) {
      forceClick(inner);
    }
    await sleep(getRunDelayMs(run, 1.5, 2500));
    if (shouldStop()) {
      return;
    }
    await waitForFlightCards(12000);
  }

  async function collectResultsForCurrentDate(run, dateText) {
    const selectedCabins = getRunCabinCodes(run);
    const seedCabin = getSeedCabin(run);
    let currentCabin = seedCabin;
    const attemptedCabins = new Set();

    if (!hasRunResult(run, dateText, seedCabin)) {
      let result;
      try {
        result = await inspectCurrentResults(run, dateText, seedCabin);
      } catch (error) {
        console.log("[CX Helper] inspectCurrentResults error for", dateText, seedCabin, error.message);
        result = buildUnavailableResult(dateText, seedCabin);
      }
      upsertRunResult(run, result);
      saveRunAndRender(run);
      console.log("[CX Helper] Saved seed cabin result:", dateText, seedCabin, result.available ? result.itineraries.length + " flights" : "unavailable");
    }

    while (!shouldStop()) {
      const visibleCabinTiles = findVisibleCabinTiles();
      const nextCabin = selectedCabins.find((code) =>
        code !== currentCabin &&
        !hasRunResult(run, dateText, code) &&
        visibleCabinTiles.has(code) &&
        !attemptedCabins.has(code)
      );
      if (!nextCabin) {
        break;
      }
      const cabinCode = nextCabin;
      attemptedCabins.add(cabinCode);
      if (shouldStop()) {
        return;
      }
      const switched = await selectCabinOnResults(cabinCode, currentCabin);
      if (!switched) {
        continue;
      }
      currentCabin = cabinCode;
      let result;
      try {
        result = await inspectCurrentResults(run, dateText, cabinCode);
      } catch (error) {
        console.log("[CX Helper] inspectCurrentResults error for extra cabin", dateText, cabinCode, error.message);
        result = buildUnavailableResult(dateText, cabinCode);
      }
      upsertRunResult(run, result);
      saveRunAndRender(run);
      console.log("[CX Helper] Saved extra cabin result:", dateText, cabinCode, result.available ? result.itineraries.length + " flights" : "unavailable");
    }

    if (currentCabin !== seedCabin) {
      const restored = await selectCabinOnResults(seedCabin, currentCabin);
      if (restored) {
        console.log("[CX Helper] Restored seed cabin on results page:", seedCabin);
      }
    }
  }

  function hasPendingVisibleCabinResults(run, dateText) {
    const visibleCabinTiles = findVisibleCabinTiles();
    return getRunCabinCodes(run).some((cabinCode) => {
      if (hasRunResult(run, dateText, cabinCode)) {
        return false;
      }
      return cabinCode === getSeedCabin(run) || visibleCabinTiles.has(cabinCode);
    });
  }

  function getActiveSnapshotEntry(snapshot, preferredDate) {
    if (!Array.isArray(snapshot) || snapshot.length === 0) {
      return null;
    }
    return snapshot.find((entry) => entry.selected && entry.date) ||
      snapshot.find((entry) => entry.date === preferredDate) ||
      null;
  }

  async function processSeedCabinFromResultsPage(run) {
    const seedCabin = getSeedCabin(run);
    const targetDate = addDays(run.startDate, run.offset || 0);
    let currentFocusDate = targetDate;
    let windowMoves = 0;

    setStatus(`Checking ${formatDisplayDate(targetDate)} ${getCabinLabel(seedCabin)} (${Math.max(1, getDateOffset(run, targetDate) + 1)}/${run.days})...`);

    try {
      await waitForResultsPageReady(20000);
      const dismissedInitialModal = await dismissNoAvailabilityModalIfPresent();
      if (dismissedInitialModal && !hasRunResult(run, targetDate, seedCabin)) {
        upsertRunResult(run, buildUnavailableResult(targetDate, seedCabin));
        saveRunAndRender(run);
      }
      if (!dismissedInitialModal) {
        const dateStatus = await ensureResultsDateSelected(targetDate);
        if (dateStatus === "unavailable" && !hasRunResult(run, targetDate, seedCabin)) {
          upsertRunResult(run, buildUnavailableResult(targetDate, seedCabin));
          saveRunAndRender(run);
        }
      }
    } catch (error) {
      console.log("[CX Helper] Initial date selection error:", error.message);
    }

    while (!shouldStop() && windowMoves < 12) {
      await dismissNoAvailabilityModalIfPresent();
      const activeDate = getCurrentResultsDate() || currentFocusDate || targetDate;
      let snapshot = markVisibleUnavailableDates(run, seedCabin, activeDate);
      if (!snapshot.length) {
        console.log("[CX Helper] No strip snapshot available on results page");
        break;
      }
      console.log("[CX Helper] Strip snapshot dates:", snapshot.map((entry) => `${entry.date || "?"}${entry.selected ? "*" : ""}${entry.unavailable ? ":NA" : ""}`));

      const activeEntry = getActiveSnapshotEntry(snapshot, currentFocusDate);
      if (activeEntry && activeEntry.date) {
        currentFocusDate = activeEntry.date;
      }
      console.log("[CX Helper] Active strip focus:", currentFocusDate, activeEntry ? activeEntry.text : "none");
      if (activeEntry && isDateWithinRun(run, activeEntry.date) && !activeEntry.unavailable && hasPendingVisibleCabinResults(run, activeEntry.date)) {
        const progress = Math.max(1, getDateOffset(run, activeEntry.date) + 1);
        setStatus(`Checking ${formatDisplayDate(activeEntry.date)} ${getCabinLabel(seedCabin)} (${progress}/${run.days})...`);
        await collectResultsForCurrentDate(run, activeEntry.date);
        snapshot = markVisibleUnavailableDates(run, seedCabin, getCurrentResultsDate() || activeEntry.date);
      }

      const nextPending = snapshot.find((entry) => entry.date && isDateWithinRun(run, entry.date) && !hasRunResult(run, entry.date, seedCabin));
      if (nextPending) {
        console.log("[CX Helper] Next pending date in strip:", nextPending.date, nextPending.text);
        if (nextPending.unavailable) {
          upsertRunResult(run, buildUnavailableResult(nextPending.date, seedCabin));
          saveRunAndRender(run);
          continue;
        }
        const progress = Math.max(1, getDateOffset(run, nextPending.date) + 1);
        setStatus(`Checking ${formatDisplayDate(nextPending.date)} ${getCabinLabel(seedCabin)} (${progress}/${run.days})...`);
        await clickStripSnapshotEntry(nextPending, run);
        currentFocusDate = nextPending.date;
        continue;
      }

      if (hasCompletedCabinRange(run, seedCabin)) {
        return true;
      }

      const beforeMax = snapshot.filter((entry) => entry.date).map((entry) => entry.date).sort().slice(-1)[0] || "";
      const nextArrow = findCalendarNextArrow();
      if (!nextArrow) {
        console.log("[CX Helper] No results-page next arrow found for seed cabin", seedCabin);
        break;
      }
      console.log("[CX Helper] Advancing results strip window for seed cabin", seedCabin);
      clickElement(nextArrow);
      await sleep(getRunDelayMs(run, 1.25, 2200));
      await waitForResultsPageReady(20000);
      const afterSnapshot = getVisibleStripSnapshot(getCurrentResultsDate() || currentFocusDate || activeDate);
      const afterMax = afterSnapshot.filter((entry) => entry.date).map((entry) => entry.date).sort().slice(-1)[0] || "";
      if (beforeMax && afterMax && afterMax <= beforeMax) {
        console.log("[CX Helper] Results strip did not advance. beforeMax=", beforeMax, "afterMax=", afterMax);
        break;
      }
      const selectedAfterArrow = getActiveSnapshotEntry(afterSnapshot, currentFocusDate);
      if (selectedAfterArrow && selectedAfterArrow.date) {
        currentFocusDate = selectedAfterArrow.date;
      }
      windowMoves += 1;
    }

    return hasCompletedCabinRange(run, seedCabin);
  }

  async function continueRunFromResultsPage() {
    const run = loadRun();
    if (!run || !run.active || state.running || !isResultsPage()) {
      return;
    }
    state.running = true;
    const seedCabin = getSeedCabin(run);
    const targetDate = addDays(run.startDate, run.offset || 0);
    console.log("[CX Helper] === continueRunFromResultsPage: target=", targetDate,
      "offset=", run.offset, "days=", run.days, "seedCabin=", seedCabin,
      "cabins=", getRunCabinCodes(run));

    try {
      const completedSeed = await processSeedCabinFromResultsPage(run);
      if (shouldStop()) {
        state.running = false;
        return;
      }
      if (completedSeed) {
        console.log("[CX Helper] Completed results-page pass for seed cabin", seedCabin);
      }
      if (hasFinishedAllResults(run)) {
        run.active = false;
        run.phase = "done";
        saveRunAndRender(run);
        setStatus(`Finished ${run.results.length} date/cabin result${run.results.length === 1 ? "" : "s"}.`);
        return;
      }

      const nextPending = findNextPendingSeed(run);
      if (!nextPending) {
        run.active = false;
        run.phase = "done";
        saveRunAndRender(run);
        setStatus(`Finished ${run.results.length} date/cabin result${run.results.length === 1 ? "" : "s"}.`);
        return;
      }

      run.offset = nextPending.offset;
      run.seedCabin = nextPending.cabinCode;
      run.phase = "go-homepage";
      saveRunAndRender(run);
      setStatus(`Returning to homepage for ${formatDisplayDate(nextPending.dateText)} ${getCabinLabel(nextPending.cabinCode)}...`);
      armRunCooldown(run, getRunDelayMs(run, 2.5, 5000), "returning to homepage for the next seed search");
      navigateToHomepage(run, `Returning to homepage for ${formatDisplayDate(nextPending.dateText)} ${getCabinLabel(nextPending.cabinCode)}...`);
    } catch (error) {
      console.log("[CX Helper] continueRunFromResultsPage FATAL error:", error.message, error.stack);
      run.active = false;
      saveRun(run);
      setStatus(`Stopped: ${error.message}`);
    } finally {
      state.running = false;
    }
  }

  function buildRunFromSettings() {
    let settings;
    try {
      settings = readFormSettings();
      settings.origin = normalizeAirportCode(settings.origin);
      settings.destination = normalizeAirportCode(settings.destination);
      settings.startDate = normalizeDate(settings.startDate);
      settings.cabins = getRunCabinCodes(settings);
      saveSettings(settings);
    } catch (error) {
      setStatus(`Stopped: ${error.message}`);
      return null;
    }

    return {
      active: true,
      phase: "homepage-search",
      offset: 0,
      startDate: settings.startDate,
      days: settings.days,
      adults: settings.adults,
      cabinCodes: settings.cabins,
      seedCabin: settings.cabins[0],
      directOnly: settings.directOnly,
      delayMs: (settings.delayS || DEFAULT_DELAY_S) * 1000,
      origin: settings.origin,
      destination: settings.destination,
      settings: settings, // preserve form values across cross-origin navigation
      results: [],
      startedAt: new Date().toISOString(),
    };
  }

  /**
   * Set the cabin class and passenger count on the Cathay homepage.
   * Opens the "Cabin class and passengers" popup, selects the class, adjusts adults, clicks Done.
   */
  async function setHomepageCabinAndPassengers(cabinCode, adults) {
    const cabinLabel = CABIN_LABELS[cabinCode];
    if (!cabinLabel) {
      console.log("[CX Helper] Unknown cabin code:", cabinCode);
      return;
    }

    // Find the "Cabin class and passengers" clickable area on the homepage.
    // It shows text like "Cabin class and passengers\nPremium Economy, 1 Adult"
    // Pick the SMALLEST matching element to get the actual clickable field, not a huge parent.
    const cabinCandidates = findVisibleElements("div, button, section").filter((el) => {
      const text = normalizeText(el.innerText);
      return /Cabin class and passengers/i.test(text) && text.length < 200;
    });
    cabinCandidates.sort((a, b) => {
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      return (ra.width * ra.height) - (rb.width * rb.height);
    });
    const cabinField = cabinCandidates[0];

    if (!cabinField) {
      console.log("[CX Helper] Could not find 'Cabin class and passengers' field");
      return;
    }

    const currentText = normalizeText(cabinField.innerText);
    const currentCabinOk = new RegExp(cabinLabel, "i").test(currentText);
    const currentAdultsOk = adults === 1
      ? /1 Adult\b/i.test(currentText)
      : new RegExp(adults + " Adult", "i").test(currentText);

    if (currentCabinOk && currentAdultsOk) {
      console.log("[CX Helper] Cabin and passengers already set correctly:", currentText);
      return;
    }

    console.log("[CX Helper] Opening cabin/passenger popup. Current:", currentText,
      "Want:", cabinLabel, adults, "adults");
    console.log("[CX Helper] cabinField:", cabinField.tagName, cabinField.className,
      "rect:", JSON.stringify(cabinField.getBoundingClientRect()));

    // Try multiple strategies to open the popup
    function isPopupOpen() {
      const bodyText = document.body ? document.body.innerText : "";
      // Check for various popup indicators
      return /Select cabin class/i.test(bodyText) ||
        (/\bClass\b/.test(bodyText) && /Adults\s*\(12\+\)/i.test(bodyText) && /\bDone\b/i.test(bodyText));
    }

    let popupReady = false;

    // Strategy A: Click the smallest matching element directly
    console.log("[CX Helper] Popup strategy A: click smallest cabinField");
    forceClick(cabinField);
    await sleep(1500);
    if (isPopupOpen()) { popupReady = true; }

    // Strategy B: Try clicking each candidate from smallest to largest
    if (!popupReady) {
      for (let ci = 0; ci < Math.min(cabinCandidates.length, 5); ci++) {
        const candidate = cabinCandidates[ci];
        if (candidate === cabinField) continue;
        console.log("[CX Helper] Popup strategy B: click candidate", ci,
          candidate.tagName, candidate.className.slice(0, 60));
        forceClick(candidate);
        await sleep(1200);
        if (isPopupOpen()) { popupReady = true; break; }
      }
    }

    // Strategy C: Look for an element with data-slot or specific class related to cabin
    if (!popupReady) {
      const cabinTrigger = findVisibleElements("div, button, a").find((el) => {
        const text = normalizeText(el.innerText);
        return /(Premium Economy|Economy|Business|First),?\s*\d+\s*Adult/i.test(text) &&
          text.length < 80;
      });
      if (cabinTrigger) {
        console.log("[CX Helper] Popup strategy C: click cabin trigger:",
          cabinTrigger.tagName, normalizeText(cabinTrigger.innerText).slice(0, 50));
        forceClick(cabinTrigger);
        await sleep(1200);
        if (isPopupOpen()) { popupReady = true; }
        // Also try parent
        if (!popupReady && cabinTrigger.parentElement) {
          forceClick(cabinTrigger.parentElement);
          await sleep(1200);
          if (isPopupOpen()) { popupReady = true; }
        }
      }
    }

    // Strategy D: Try native .click() on the cabin field and its parents
    if (!popupReady) {
      console.log("[CX Helper] Popup strategy D: native .click() on field and parents");
      let el = cabinField;
      for (let depth = 0; depth < 4 && el; depth++) {
        try { el.click(); } catch (e) { /* ignore */ }
        await sleep(1000);
        if (isPopupOpen()) { popupReady = true; break; }
        el = el.parentElement;
      }
    }

    // Wait a bit more for any slow popup animation
    if (!popupReady) {
      for (let w = 0; w < 6; w++) {
        await sleep(500);
        if (isPopupOpen()) { popupReady = true; break; }
      }
    }

    if (!popupReady) {
      console.log("[CX Helper] Cabin popup did not open after all strategies");
      return;
    }
    console.log("[CX Helper] Cabin popup is open");

    // --- Set cabin class ---
    if (!currentCabinOk) {
      // The Class dropdown is a custom component. The trigger is the SPAN showing the
      // current cabin value (e.g., "Premium Economy") — clicking it with native .click()
      // opens the dropdown list. Then click the target option to select it.
      console.log("[CX Helper] Setting cabin class. Want:", cabinLabel);

      // Helper: check if dropdown options are visible
      function countVisibleCabinOptions() {
        const opts = findVisibleElements("*").filter((o) => {
          const t = normalizeText(o.innerText);
          return /^(First|Business|Premium Economy|Economy)$/i.test(t);
        });
        return new Set(opts.map((o) => normalizeText(o.innerText)));
      }

      let dropdownOpened = false;

      // Primary: click the current cabin value text (SPAN.dropdown__value or similar)
      const valueEls = findVisibleElements("div, span, p").filter((el) => {
        const t = normalizeText(el.innerText);
        return /^(First|Business|Premium Economy|Economy)$/i.test(t);
      });
      valueEls.sort((a, b) => {
        const ra = a.getBoundingClientRect();
        const rb = b.getBoundingClientRect();
        return (ra.width * ra.height) - (rb.width * rb.height);
      });
      for (const el of valueEls.slice(0, 3)) {
        console.log("[CX Helper] Clicking cabin value:", el.tagName,
          (el.className || "").split(" ")[0], normalizeText(el.innerText));
        el.click();
        await sleep(800);
        const opts = countVisibleCabinOptions();
        if (opts.size >= 3) {
          console.log("[CX Helper] Dropdown opened with options:", Array.from(opts));
          dropdownOpened = true;
          break;
        }
      }

      // Fallback: try clicking dropdown container divs
      if (!dropdownOpened) {
        const dropdownEls = findVisibleElements("div").filter((el) => {
          const text = normalizeText(el.innerText);
          return /Class/i.test(text) && /(First|Business|Premium Economy|Economy)/i.test(text) &&
            text.length < 80;
        });
        dropdownEls.sort((a, b) => {
          const ra = a.getBoundingClientRect();
          const rb = b.getBoundingClientRect();
          return (ra.width * ra.height) - (rb.width * rb.height);
        });
        for (const el of dropdownEls.slice(0, 3)) {
          el.click();
          await sleep(800);
          if (countVisibleCabinOptions().size >= 3) { dropdownOpened = true; break; }
          forceClick(el);
          await sleep(800);
          if (countVisibleCabinOptions().size >= 3) { dropdownOpened = true; break; }
        }
      }

      if (dropdownOpened) {
        // Click the target cabin option (smallest matching element)
        await sleep(300);
        const optionEls = findVisibleElements("*").filter((el) => {
          return normalizeText(el.innerText) === cabinLabel;
        });
        optionEls.sort((a, b) => {
          const ra = a.getBoundingClientRect();
          const rb = b.getBoundingClientRect();
          return (ra.width * ra.height) - (rb.width * rb.height);
        });
        if (optionEls.length > 0) {
          console.log("[CX Helper] Selecting cabin:", cabinLabel,
            optionEls[0].tagName, (optionEls[0].className || "").split(" ")[0]);
          optionEls[0].click();
          await sleep(1000);
          console.log("[CX Helper] Cabin set to", cabinLabel);
        } else {
          console.log("[CX Helper] Could not find option:", cabinLabel);
        }
      } else {
        console.log("[CX Helper] Could not open class dropdown");
      }
    }

    // --- Set adult count ---
    if (!currentAdultsOk) {
      await setAdultCount(adults);
    }

    // Click Done button - search broadly (may not be a <button>)
    await sleep(500);
    for (let attempt = 0; attempt < 3; attempt++) {
      // Find all elements with "Done" text, sort smallest first to get actual button not container
      const doneCandidates = findVisibleElements("button, div, a, span, *").filter((el) => {
        return /^Done$/i.test(normalizeText(el.innerText));
      });
      doneCandidates.sort((a, b) => {
        const ra = a.getBoundingClientRect();
        const rb = b.getBoundingClientRect();
        return (ra.width * ra.height) - (rb.width * rb.height);
      });
      const doneBtn = doneCandidates[0];
      if (doneBtn) {
        console.log("[CX Helper] Clicking Done (attempt " + (attempt + 1) + "):",
          doneBtn.tagName, doneBtn.className.split(" ")[0],
          Math.round(doneBtn.getBoundingClientRect().width) + "x" +
          Math.round(doneBtn.getBoundingClientRect().height),
          "of", doneCandidates.length, "candidates");
        forceClick(doneBtn);
        await sleep(1000);
        // Verify popup closed
        const bodyText = document.body ? document.body.innerText : "";
        if (!/Adults\s*\(12\+\)/i.test(bodyText)) {
          console.log("[CX Helper] Cabin popup closed");
          return;
        }
        // If smallest didn't work and there are more candidates, try next
        if (doneCandidates.length > 1 && attempt === 0) {
          console.log("[CX Helper] Trying next Done candidate:",
            doneCandidates[1].tagName, doneCandidates[1].className.split(" ")[0]);
          forceClick(doneCandidates[1]);
          await sleep(1000);
          const bodyAfterRetry = document.body ? document.body.innerText : "";
          if (!/Adults\s*\(12\+\)/i.test(bodyAfterRetry)) {
            console.log("[CX Helper] Cabin popup closed via candidate 2");
            return;
          }
        }
      } else {
        console.log("[CX Helper] Done element not found, attempt", attempt + 1);
        break;
      }
    }
    console.log("[CX Helper] Cabin/passenger setup complete");
  }

  async function setAdultCount(targetAdults) {
    console.log("[CX Helper] setAdultCount: target =", targetAdults);

    // Best approach: Find +/- buttons directly via aria-label.
    // The logs showed buttons with aria-label "Decrease adult" and "Increase adult".
    const allBtns = findVisibleElements("button, [role='button']");
    let minusBtn = allBtns.find((b) => /decrease\s*adult/i.test(b.getAttribute("aria-label") || ""));
    let plusBtn = allBtns.find((b) => /increase\s*adult/i.test(b.getAttribute("aria-label") || ""));

    // Fallback: find buttons with – and + text near "Adults" label
    if (!minusBtn || !plusBtn) {
      console.log("[CX Helper] aria-label buttons not found, trying text/position approach");
      const smallBtns = allBtns.filter((b) => {
        const r = b.getBoundingClientRect();
        return r.width > 0 && r.width < 60 && r.height < 60;
      });
      if (!minusBtn) {
        minusBtn = smallBtns.find((b) => /^[−\-\u2212]$/.test(normalizeText(b.innerText).trim()));
      }
      if (!plusBtn) {
        plusBtn = smallBtns.find((b) => /^\+$/.test(normalizeText(b.innerText).trim()));
      }
    }

    if (!minusBtn || !plusBtn) {
      console.log("[CX Helper] Could not find adult +/- buttons");
      // Dump for debugging
      const relevantBtns = allBtns.filter((b) => {
        const aria = (b.getAttribute("aria-label") || "").toLowerCase();
        const text = normalizeText(b.innerText).trim();
        return aria.includes("adult") || aria.includes("crease") ||
          /^[−\-\u2212+]$/.test(text);
      });
      console.log("[CX Helper] Relevant buttons:",
        relevantBtns.map((b) => b.tagName + " text:'" + normalizeText(b.innerText).slice(0, 5) +
          "' aria:'" + (b.getAttribute("aria-label") || "") + "'"));
      return;
    }

    console.log("[CX Helper] Found adult buttons:",
      "minus:", minusBtn.getAttribute("aria-label") || normalizeText(minusBtn.innerText),
      "plus:", plusBtn.getAttribute("aria-label") || normalizeText(plusBtn.innerText));

    // Read current count: find the number element between the – and + buttons
    // Look for a sibling or nearby element that contains just a number
    let current = 1;
    const minusRect = minusBtn.getBoundingClientRect();
    const plusRect = plusBtn.getBoundingClientRect();
    const countEls = findVisibleElements("span, div, p, input").filter((el) => {
      const r = el.getBoundingClientRect();
      const text = normalizeText(el.innerText || el.value || "").trim();
      // Must be a single number, positioned between minus and plus buttons
      return /^\d+$/.test(text) &&
        r.left >= minusRect.left - 5 &&
        r.right <= plusRect.right + 5 &&
        Math.abs(r.top - minusRect.top) < 30;
    });
    if (countEls.length > 0) {
      current = Number(normalizeText(countEls[0].innerText || countEls[0].value || "1").trim());
    }
    // Also check for input[type=number] between buttons
    if (countEls.length === 0) {
      const inputs = findVisibleElements("input").filter((el) => {
        const r = el.getBoundingClientRect();
        return r.left >= minusRect.left - 5 && r.right <= plusRect.right + 5 &&
          Math.abs(r.top - minusRect.top) < 30;
      });
      if (inputs.length > 0) {
        current = Number(inputs[0].value) || 1;
      }
    }
    console.log("[CX Helper] Adults count: current =", current, "target =", targetAdults);

    // Click + or - to reach target
    let clicks = 0;
    while (current < targetAdults && clicks < 8) {
      console.log("[CX Helper] Clicking + for adults:", current, "->", current + 1);
      forceClick(plusBtn);
      current++;
      clicks++;
      await sleep(500);
    }
    while (current > targetAdults && current > 1 && clicks < 8) {
      console.log("[CX Helper] Clicking - for adults:", current, "->", current - 1);
      forceClick(minusBtn);
      current--;
      clicks++;
      await sleep(500);
    }
    console.log("[CX Helper] Adults count set to", current);
  }

  async function launchHomepageSearchForRun(run) {
    if (state.running) {
      console.log("[CX Helper] launchHomepageSearchForRun skipped because another automation step is already running");
      return;
    }
    state.running = true;
    console.log("[CX Helper] launchHomepageSearchForRun: starting, isHomepage=", isHomepage());
    try {
      await waitForRunCooldown(run, "Waiting before the next Cathay search...");
      if (shouldStop()) {
        return;
      }
      if (!isHomepage()) {
        setStatus("Stopped: Start from Cathay's homepage booking form.");
        return;
      }
      const pending = findNextPendingSeed(run);
      if (pending) {
        run.offset = pending.offset;
        run.seedCabin = pending.cabinCode;
        saveRunAndRender(run);
      }
      const seedCabin = getSeedCabin(run);
      setStatus("Enabling Book with miles...");
      const milesReady = await ensureMilesToggleOn();
      console.log("[CX Helper] ensureMilesToggleOn returned:", milesReady);
      if (shouldStop()) {
        return;
      }
      if (!milesReady) {
        setStatus('Stopped: Could not turn on "Book with miles" automatically.');
        return;
      }
      if (seedCabin || run.adults > 1) {
        setStatus(`Setting cabin and passengers (${getCabinLabel(seedCabin)})...`);
        try {
          await setHomepageCabinAndPassengers(seedCabin, run.adults || 1);
        } catch (e) {
          console.log("[CX Helper] setHomepageCabinAndPassengers error (non-fatal):", e.message);
        }
        if (shouldStop()) {
          return;
        }
      }

      const targetDate = addDays(run.startDate, run.offset || 0);
      setStatus(`Setting homepage date to ${formatDisplayDate(targetDate)} for ${getCabinLabel(seedCabin)}...`);
      console.log("[CX Helper] About to set homepage date to:", targetDate, "seedCabin:", seedCabin);
      const dateReady = await setHomepageDepartingDate(targetDate);
      console.log("[CX Helper] setHomepageDepartingDate returned:", dateReady);
      if (shouldStop()) {
        return;
      }
      if (!dateReady) {
        setStatus("Stopped: Could not set Cathay's homepage date.");
        return;
      }
      const searchButton = findHomepageSearchButton();
      console.log("[CX Helper] findHomepageSearchButton:", searchButton ? searchButton.tagName + " '" + normalizeText(searchButton.innerText) + "'" : "NOT FOUND");
      if (!searchButton) {
        setStatus("Stopped: Could not find Cathay's homepage search button.");
        return;
      }
      run.phase = "await-results";
      armRunCooldown(run, getRunDelayMs(run, 2, 4000), "submitting Cathay homepage search");
      saveRunAndRender(run);
      setStatus(`Opening Cathay results for ${formatDisplayDate(targetDate)} ${getCabinLabel(seedCabin)}...`);
      if (shouldStop()) {
        return;
      }
      clickElement(searchButton);
    } finally {
      state.running = false;
    }
  }

  async function startRunFromHomepage() {
    const run = buildRunFromSettings();
    if (!run) {
      return;
    }

    if (!isHomepage()) {
      if (isResultsPage()) {
        run.phase = "go-homepage";
        saveRun(run);
        setStatus("Returning to Cathay's homepage booking form...");
        navigateToHomepage(run, "Returning to Cathay's homepage booking form...");
        return;
      }
      setStatus("Stopped: Start from Cathay's homepage booking form.");
      return;
    }
    await launchHomepageSearchForRun(run);
  }

  function stopRun() {
    const run = loadRun();
    if (run) {
      run.active = false;
      run.phase = "stopped";
      saveRun(run);
    }
    state.running = false;
    state.stopping = true;
    setStatus("Stopped.");
  }

  function onStopClick() {
    stopRun();
    console.log("[CX Helper] Stop button clicked - automation halted");
  }

  async function onSearchClick() {
    if (state.running) {
      return;
    }
    state.stopping = false;
    await startRunFromHomepage();
  }

  function onSaveDefaultsClick() {
    try {
      const settings = readFormSettings();
      settings.origin = normalizeAirportCode(settings.origin);
      settings.destination = normalizeAirportCode(settings.destination);
      settings.startDate = settings.startDate ? normalizeDate(settings.startDate) : "";
      saveSettings(settings);
      setStatus("Saved your defaults in the browser.");
    } catch (error) {
      setStatus(`Stopped: ${error.message}`);
    }
  }

  function onResetDefaultsClick() {
    clearSettings();
    fillForm(Object.assign({}, DEFAULT_SETTINGS));
    setStatus("Cleared saved defaults.");
  }

  function onClearRunClick() {
    stopRun();
    clearRun();
    renderResults();
    setStatus('Cleared. Set your route on Cathay\'s homepage, then click Search date range.');
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${PANEL_ID} {
        position: fixed;
        top: 20px;
        right: 20px;
        left: auto;
        z-index: 2147483647;
        width: min(620px, calc(100vw - 40px));
        max-width: calc(100vw - 40px);
        background: rgba(16, 27, 29, 0.96);
        color: #f3f0e8;
        border: 1px solid #6b8a84;
        border-radius: 14px;
        box-shadow: 0 16px 40px rgba(0, 0, 0, 0.35);
        font: 13px/1.4 ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      #${PANEL_ID} * { box-sizing: border-box; }
      #${PANEL_ID} #cxah-body {
        max-height: calc(100vh - 70px);
        overflow-y: auto;
        overflow-x: auto;
      }
      #${PANEL_ID} .cxah-head {
        padding: 12px 14px 8px;
        font-size: 14px;
        font-weight: 700;
        display: flex;
        justify-content: space-between;
        align-items: center;
        cursor: grab;
        user-select: none;
      }
      #${PANEL_ID} .cxah-head:active { cursor: grabbing; }
      #${PANEL_ID} .cxah-collapse-btn {
        width: 28px !important;
        height: 28px;
        padding: 0;
        font-size: 18px;
        line-height: 1;
        border-radius: 6px;
        background: rgba(255,255,255,0.08);
        border: 1px solid #59716c;
        color: #f3f0e8;
        cursor: pointer;
        flex-shrink: 0;
      }
      #${PANEL_ID} .cxah-collapse-btn:hover { background: rgba(255,255,255,0.15); }
      #${PANEL_ID} .cxah-steps {
        margin: 0 14px 12px;
        padding: 10px 12px;
        border: 1px solid #2f4946;
        border-radius: 10px;
        background: rgba(255, 255, 255, 0.03);
      }
      #${PANEL_ID} .cxah-steps div {
        margin: 0 0 6px;
      }
      #${PANEL_ID} .cxah-steps div:last-child {
        margin-bottom: 0;
      }
      #${PANEL_ID} .cxah-seed-meta {
        color: #9fb6b0;
        font-size: 11px;
      }
      #${PANEL_ID} .cxah-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
        padding: 0 14px 12px;
      }
      #${PANEL_ID} .cxah-section-title {
        grid-column: 1 / -1;
        margin-top: 2px;
        font-size: 11px;
        font-weight: 700;
        color: #d8e8e4;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      #${PANEL_ID} label {
        display: block;
        font-size: 11px;
        color: #9fb6b0;
        margin-bottom: 4px;
      }
      #${PANEL_ID} input, #${PANEL_ID} select, #${PANEL_ID} button {
        width: 100%;
        border-radius: 8px;
        border: 1px solid #59716c;
        padding: 8px 10px;
        background: #152325;
        color: #f3f0e8;
      }
      #${PANEL_ID} select {
        -webkit-appearance: none;
        appearance: none;
      }
      #${PANEL_ID} select {
        background: #152325 url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%239fb6b0' stroke-width='1.5' fill='none'/%3E%3C/svg%3E") no-repeat right 10px center;
        padding-right: 28px;
      }
      #${PANEL_ID} select option {
        background: #152325;
        color: #f3f0e8;
      }
      #${PANEL_ID} button {
        background: #2a6d68;
        cursor: pointer;
        font-weight: 700;
      }
      #${PANEL_ID} button:hover { background: #34827b; }
      #${PANEL_ID} .cxah-actions {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
        padding: 0 14px 12px;
      }
      #${PANEL_ID} .cxah-actions .cxah-run {
        grid-column: 1 / -1;
      }
      #${PANEL_ID} .cxah-status {
        padding: 0 14px 10px;
        color: #d8e8e4;
        font-weight: 600;
      }
      #${PANEL_ID} .cxah-toggle-row {
        grid-column: 1 / -1;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 2px 0 4px;
      }
      #${PANEL_ID} .cxah-toggle-row input[type="checkbox"] {
        width: auto;
        margin: 0;
        accent-color: #34827b;
      }
      #${PANEL_ID} .cxah-toggle-row label {
        margin: 0;
        font-size: 13px;
        color: #f3f0e8;
      }
      #${PANEL_ID} .cxah-cabin-group {
        grid-column: 1 / -1;
      }
      #${PANEL_ID} .cxah-cabin-options {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 6px;
      }
      #${PANEL_ID} .cxah-cabin-option {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 10px;
        border: 1px solid #59716c;
        border-radius: 8px;
        background: #152325;
      }
      #${PANEL_ID} .cxah-cabin-option input[type="checkbox"] {
        width: auto;
        margin: 0;
        accent-color: #34827b;
      }
      #${PANEL_ID} .cxah-cabin-option label {
        margin: 0;
        font-size: 12px;
        color: #f3f0e8;
      }
      #${PANEL_ID} .cxah-table-wrap {
        margin: 0 14px 14px;
        overflow-x: auto;
        overflow-y: auto;
        -webkit-overflow-scrolling: touch;
        max-height: min(260px, 32vh);
        border-top: 1px solid #2f4946;
      }
      #${PANEL_ID} table {
        width: max-content;
        min-width: 100%;
        margin: 0;
        border-collapse: collapse;
        font-size: 12px;
      }
      #${PANEL_ID} thead th {
        position: sticky;
        top: 0;
        background: rgba(16, 27, 29, 0.98);
        z-index: 1;
      }
      #${PANEL_ID} th, #${PANEL_ID} td {
        border-top: 1px solid #2f4946;
        padding: 5px 3px;
        text-align: left;
        vertical-align: top;
        white-space: nowrap;
      }
      #${PANEL_ID} th { font-size: 10px; color: #9fb6b0; }
      #${PANEL_ID} .cxah-note {
        padding: 0 14px 14px;
        color: #9fb6b0;
        font-size: 11px;
      }
    `;
    document.documentElement.appendChild(style);
  }

  function ensurePanel() {
    if (document.getElementById(PANEL_ID)) {
      return;
    }
    ensureStyles();
    const settings = getPanelSettingsSource();
    const run = loadRun();
    if (run && Array.isArray(run.results)) {
      state.results = run.results;
    }

    const panel = document.createElement("section");
    panel.id = PANEL_ID;
    const delayVal = settings.delayS || DEFAULT_DELAY_S;
    const selectedCabins = getRunCabinCodes(settings);
    const cabinIds = getCabinCheckboxIds();
    panel.innerHTML = `
      <div class="cxah-head">
        <span>Cathay Award Helper</span>
        <button type="button" id="cxah-collapse" class="cxah-collapse-btn" title="Collapse">&ndash;</button>
      </div>
      <div id="cxah-body">
        <div class="cxah-steps">
          <div>1. Log in to your Cathay account and set your route &amp; trip type on the homepage.</div>
          <div>2. Fill in start date, cabin(s), and days below.</div>
          <div>3. Click "Search date range" and use the browser console to debug with the script logs if needed.</div>
          <div class="cxah-seed-meta">${run && run.active ? `Active run started ${new Date(run.startedAt).toLocaleString()}` : ""}</div>
        </div>
        <div class="cxah-grid">
          <div>
            <label for="cxah-route-preset">Route</label>
            <select id="cxah-route-preset">
              ${buildOptions(ROUTE_PRESETS, settings.routePreset || "")}
            </select>
          </div>
          <div class="cxah-cabin-group">
            <label>Cabins</label>
            <div class="cxah-cabin-options">
              <div class="cxah-cabin-option">
                <input id="${cabinIds.Y}" type="checkbox" ${selectedCabins.includes("Y") ? "checked" : ""} />
                <label for="${cabinIds.Y}">Economy</label>
              </div>
              <div class="cxah-cabin-option">
                <input id="${cabinIds.PY}" type="checkbox" ${selectedCabins.includes("PY") ? "checked" : ""} />
                <label for="${cabinIds.PY}">Premium Economy</label>
              </div>
              <div class="cxah-cabin-option">
                <input id="${cabinIds.J}" type="checkbox" ${selectedCabins.includes("J") ? "checked" : ""} />
                <label for="${cabinIds.J}">Business</label>
              </div>
              <div class="cxah-cabin-option">
                <input id="${cabinIds.F}" type="checkbox" ${selectedCabins.includes("F") ? "checked" : ""} />
                <label for="${cabinIds.F}">First</label>
              </div>
            </div>
          </div>
          <div>
            <label for="cxah-origin">Origin</label>
            <input id="cxah-origin" maxlength="40" placeholder="JFK" value="${settings.origin}" />
          </div>
          <div style="display:flex;align-items:center;justify-content:center;">
            <button type="button" id="cxah-swap-route" title="Swap origin and destination"
              style="background:#3a4a46;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:16px;padding:2px 8px;line-height:1;">\u21c4</button>
          </div>
          <div>
            <label for="cxah-destination">Destination</label>
            <input id="cxah-destination" maxlength="40" placeholder="HKG" value="${settings.destination}" />
          </div>
          <div>
            <label for="cxah-start-date">Start date</label>
            <input id="cxah-start-date" type="date" value="${settings.startDate}" />
          </div>
          <div>
            <label for="cxah-days">Days (max ${MAX_DAYS})</label>
            <input id="cxah-days" type="number" min="1" max="${MAX_DAYS}" value="${settings.days}" />
          </div>
          <div>
            <label for="cxah-adults">Adults</label>
            <input id="cxah-adults" type="number" min="1" max="4" value="${settings.adults}" />
          </div>
          <div>
            <label for="cxah-delay">Delay (sec)</label>
            <input id="cxah-delay" type="number" min="1" max="30" step="1" value="${delayVal}" />
          </div>
          <div class="cxah-toggle-row">
            <input id="cxah-direct-only" type="checkbox" ${settings.directOnly !== false ? "checked" : ""} />
            <label for="cxah-direct-only">Direct flights only</label>
          </div>
        </div>
        <div class="cxah-actions">
          <button type="button" class="cxah-run" id="cxah-run">Search date range</button>
          <button type="button" id="cxah-stop-run" style="background:#8b3a3a;">Stop</button>
          <button type="button" id="cxah-save-defaults">Save defaults</button>
          <button type="button" id="cxah-reset-defaults">Reset defaults</button>
          <button type="button" id="cxah-clear-run">Clear current run</button>
        </div>
        <div class="cxah-status">${state.status}</div>
        <div class="cxah-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Cabin</th>
                <th>Flight</th>
                <th>Time</th>
                <th>Dur.</th>
                <th>Miles</th>
              </tr>
            </thead>
            <tbody></tbody>
          </table>
        </div>
        <div class="cxah-note">Best-effort: drives Cathay's visible UI. Install the Debug version for in-panel logs.</div>
      </div>
    `;

    document.documentElement.appendChild(panel);
    panel.querySelector("#cxah-run").addEventListener("click", onSearchClick);
    panel.querySelector("#cxah-stop-run").addEventListener("click", onStopClick);
    panel.querySelector("#cxah-save-defaults").addEventListener("click", onSaveDefaultsClick);
    panel.querySelector("#cxah-reset-defaults").addEventListener("click", onResetDefaultsClick);
    panel.querySelector("#cxah-clear-run").addEventListener("click", onClearRunClick);
    panel.querySelector("#cxah-route-preset").addEventListener("change", applyRoutePreset);
    panel.querySelector("#cxah-swap-route").addEventListener("click", onSwapRoute);
    panel.querySelector("#cxah-collapse").addEventListener("click", toggleCollapse);
    makeDraggable(panel, panel.querySelector(".cxah-head"));
    renderResults();
  }

  function makeDraggable(panel, handle) {
    let startX, startY, startLeft, startTop, dragging = false;

    handle.addEventListener("mousedown", (e) => {
      // Don't drag when clicking the collapse button
      if (e.target.closest(".cxah-collapse-btn")) return;
      dragging = true;
      const rect = panel.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      startLeft = rect.left;
      startTop = rect.top;
      e.preventDefault();
    });

    document.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      panel.style.left = (startLeft + dx) + "px";
      panel.style.top = (startTop + dy) + "px";
      panel.style.right = "auto";
    });

    document.addEventListener("mouseup", () => {
      dragging = false;
    });
  }

  function toggleCollapse() {
    const body = document.getElementById("cxah-body");
    const btn = document.getElementById("cxah-collapse");
    if (!body || !btn) return;
    const collapsed = body.style.display === "none";
    body.style.display = collapsed ? "" : "none";
    btn.textContent = collapsed ? "\u2013" : "+";
    btn.title = collapsed ? "Collapse" : "Expand";
  }

  function boot() {
    const mount = async () => {
      ensurePanel();
      renderResults();
      const run = loadRun();
      if (!run || !run.active) return;

      if (await recoverFromErrorPage(run)) {
        return;
      }

      console.log("[CX Helper] Boot: phase=", run.phase, "isHomepage=", isHomepage(),
        "isResults=", isResultsPage());

      if (run.phase === "go-homepage") {
        // Wait for homepage to fully load after navigation from results page.
        // The "New search" link triggers a full page navigation, so we need to
        // wait for the booking panel to appear.
        for (let wait = 0; wait < 20; wait++) {
          if (await recoverFromErrorPage(run)) {
            return;
          }
          if (isHomepage()) {
            console.log("[CX Helper] Homepage detected on attempt", wait);
            await launchHomepageSearchForRun(run);
            return;
          }
          console.log("[CX Helper] Waiting for homepage to load... attempt", wait);
          await sleep(1500);
        }
        console.log("[CX Helper] Homepage never loaded, stopping");
        run.active = false;
        saveRun(run);
        setStatus("Stopped: Homepage did not load after returning from results.");
        return;
      }

      if (run.phase === "await-results") {
        for (let wait = 0; wait < 20; wait++) {
          if (await recoverFromErrorPage(run)) {
            return;
          }
          if (isResultsPage()) {
            console.log("[CX Helper] Results page detected on attempt", wait);
            await continueRunFromResultsPage();
            return;
          }
          console.log("[CX Helper] Waiting for results page to load... attempt", wait);
          await sleep(1500);
        }
        console.log("[CX Helper] Results page never became detectable during await-results phase");
        setStatus("Waiting for Cathay results page...");
        return;
      }

      if (await recoverFromErrorPage(run)) {
        return;
      }

      // Also handle case where we're on results page with an active run
      if (isResultsPage()) {
        await continueRunFromResultsPage();
      }
    };

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", mount, { once: true });
    } else {
      mount();
    }
  }

  boot();
})();
