/// Shared DOM helpers for the overlay UI components.

/// Keep taps on an overlay element from reaching the Scene's
/// window level touch handlers, which would fling the layers
///
/// - Parameter element: The element to isolate
export function stopSceneEvents(element) {
	// Release events (mouseup/touchend) deliberately propagate:
	// they only clear the scene's touch state, and swallowing
	// them would leave isTouchDown stuck when a drag that began
	// on the canvas releases over this element
	const eventNames = ["mousedown", "mousemove", "touchstart", "touchmove"];
	for (const eventName of eventNames) {
		element.addEventListener(eventName, (event) => event.stopPropagation());
	}
}

/// Create an img element for an SVG string. The backing blob
/// URL is revoked once the image has loaded, so thumbnails do
/// not leak object URLs across Avastar swaps.
///
/// - Parameter svgString: The SVG string to convert
export function svgToImage(svgString) {
	const blob = new Blob([svgString], { type: "image/svg+xml" });
	const url = URL.createObjectURL(blob);
	const image = document.createElement("img");
	image.src = url;
	// Revoke on error too: a malformed SVG fires error instead
	// of load and would otherwise leak the URL
	const revoke = () => URL.revokeObjectURL(url);
	image.addEventListener("load", revoke, { once: true });
	image.addEventListener("error", revoke, { once: true });
	return image;
}
