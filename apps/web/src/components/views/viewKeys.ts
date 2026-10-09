/** Escape aimed at a field, menu or dialog belongs to that widget. */
export function isWidgetEvent(event: KeyboardEvent): boolean {
  const target = event.target;
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.closest("input, textarea, select, [role=menu], [role=dialog], [role=listbox]") !==
        null)
  );
}
