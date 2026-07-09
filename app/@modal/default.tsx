// Default for the @modal parallel slot: render nothing when the URL
// doesn't match an intercepting modal route (i.e. the normal dashboard,
// or a hard navigation to a detail page). Required by Next's parallel
// routing so the slot has something to render on every path.
export default function ModalDefault() {
  return null;
}
