// Space = Play/Stop anywhere on the page, except where Space has a native job (typing, buttons, checkboxes, selects).
const NATIVE = /^(INPUT|TEXTAREA|SELECT|BUTTON|OPTION|SUMMARY)$/;
const NATIVE_ROLES = /^(button|checkbox|switch|radio|textbox|combobox|listbox|option|menuitem|slider|spinbutton|tab)$/;

export function isSpaceToggle(e) {
  if (e.key !== ' ' || e.ctrlKey || e.metaKey || e.altKey || e.repeat || e.defaultPrevented) return false;
  const t = e.target;
  if (!t || !t.tagName) return true;
  if (NATIVE.test(t.tagName) || t.isContentEditable) return false;
  return !NATIVE_ROLES.test(t.getAttribute?.('role') || '');
}

// onSpace(fn): call fn() on a Space press that should toggle Play/Stop; stops the page scrolling. Returns an off().
export function onSpace(fn, target = globalThis) {
  const h = (e) => { if (isSpaceToggle(e)) { e.preventDefault(); fn(e); } };
  target.addEventListener('keydown', h);
  return () => target.removeEventListener('keydown', h);
}
