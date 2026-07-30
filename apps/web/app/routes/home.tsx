import Placeholder from "./placeholder";

// "/" resolves to the actor's landing module in the layout loader, so this
// renders only if that redirect is ever removed. Kept as the same placeholder
// so the fallback is a page, not a blank document.
export default Placeholder;
