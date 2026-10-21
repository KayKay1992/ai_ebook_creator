// Open/close handler for a dropdown trigger (components/layout/DashboardLayout.jsx's
// profile menu). Stops the click from reaching the document's
// "click outside closes it" listener when there is an event, and still
// works when called without one (a menu item closing the menu, a keyboard
// handler, a programmatic call). Pure, so `npm test` covers it.
export const toggleHandler = (setOpen) => (event) => {
  event?.stopPropagation?.();
  setOpen((open) => !open);
};
