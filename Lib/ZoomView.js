import Point from "./Point.js";

/// Pinch-to-zoom view state for the 2D vector scene
/// (docs/tads/pinch-zoom.md). Owns the zoom scale and pan
/// translation, the focal-point math, the pan clamp, the
/// below-1 rubber band, the double-tap glide home, and the
/// gesture-settled debounce that triggers the vector re-raster.
/// Input events stay in MainScene; physics stay in unzoomed
/// scene space (Decision 6) - this class is draw-time state only.
export default class ZoomView {
	/// - Parameters:
	///		- getViewport: () => { width, height } of the canvas
	///		- onSettled: called with the settled scale ~150ms after
	///			the zoom stops changing (Decision 1's re-raster hook)
	constructor(getViewport, onSettled) {
		this.getViewport = getViewport;
		this.onSettled = onSettled;
		this.scale = 1;
		this.tx = 0;
		this.ty = 0;
		this.isGliding = false;
		this.settleTimer = null;
	}

	/// Zoom clamps to [1, MAX_SCALE] (docs/tads/pinch-zoom.md
	/// Decision 4); an active pinch may dip to RUBBER_MIN and
	/// glides back to 1 on release (endGesture)
	static get MAX_SCALE() {
		return 4;
	}
	static get RUBBER_MIN() {
		return 0.85;
	}
	/// Re-raster resolution cap per dimension (Decision 4)
	static get MAX_RASTER_DIM() {
		return 4096;
	}
	static get SETTLE_MS() {
		return 150;
	}

	/// True when the view is actually zoomed in - the render loop
	/// and the drag-gesture split (Decision 2) read this
	get isZoomed() {
		return this.scale > 1;
	}

	/// Scale about a focal point in canvas coordinates, keeping
	/// the content under the focal point stationary
	///
	/// - Parameters:
	///		- factor: Multiplicative scale change
	///		- cx, cy: The focal point (fingers' midpoint / cursor)
	///		- allowRubber: An active pinch may dip below 1 (the
	///			release rubber-bands home); wheel zoom clamps hard
	zoomAbout(factor, cx, cy, allowRubber = false) {
		const next = Math.max(
			allowRubber ? ZoomView.RUBBER_MIN : 1,
			Math.min(ZoomView.MAX_SCALE, this.scale * factor),
		);
		const applied = next / this.scale;
		this.tx = cx - (cx - this.tx) * applied;
		this.ty = cy - (cy - this.ty) * applied;
		this.scale = next;
		this.isGliding = false;
		this.clampPan();
		this.scheduleSettle();
	}

	/// Translate the view (single-finger drag while zoomed)
	panBy(dx, dy) {
		if (!this.isZoomed) {
			return;
		}
		this.tx += dx;
		this.ty += dy;
		this.clampPan();
	}

	/// Keep the content attached to the viewport (Decision 4): at
	/// scale > 1 the edges may never pull inside the canvas; the
	/// sub-1 rubber-band state stays centered instead
	clampPan() {
		const { width, height } = this.getViewport();
		if (this.scale <= 1) {
			this.tx = (width * (1 - this.scale)) / 2;
			this.ty = (height * (1 - this.scale)) / 2;
			return;
		}
		this.tx = Math.min(0, Math.max(width * (1 - this.scale), this.tx));
		this.ty = Math.min(0, Math.max(height * (1 - this.scale), this.ty));
	}

	/// A pinch released below 1 rubber-bands home; a normal
	/// release just lets the settle debounce run
	endGesture() {
		if (this.scale < 1) {
			this.glideHome();
		}
	}

	/// Animated return to 1x (double-tap reset - Decision 2). The
	/// render loop drives the glide via update().
	glideHome() {
		this.cancelSettle();
		this.isGliding = this.scale !== 1;
		if (!this.isGliding) {
			this.clampPan();
			// Already home, but a pending settle may have just been
			// cancelled: reschedule so a base-size re-raster is never
			// lost (review catch - the stale hi-res rasters would
			// linger in memory)
			this.scheduleSettle();
		}
	}

	/// Instant reset - token loads, preview recomposes, resizes,
	/// and 3D entry (Decision 5): zoom is transient view state
	reset() {
		this.cancelSettle();
		this.isGliding = false;
		this.scale = 1;
		this.tx = 0;
		this.ty = 0;
	}

	/// Advance the glide-home animation by one frame; a no-op
	/// unless glideHome() armed it
	update(dt) {
		if (!this.isGliding) {
			return;
		}
		const ease = Math.min(1, dt * 10);
		this.scale += (1 - this.scale) * ease;
		if (Math.abs(this.scale - 1) < 0.01) {
			this.scale = 1;
			this.isGliding = false;
			this.scheduleSettle();
		}
		this.clampPan();
	}

	/// Map a canvas-space point (a tap) to unzoomed scene space,
	/// where the springs live (Decision 6)
	toScene(point) {
		return new Point(
			(point.x - this.tx) / this.scale,
			(point.y - this.ty) / this.scale,
		);
	}

	/// The raster scale for the current zoom: the zoom itself,
	/// capped so no raster dimension exceeds MAX_RASTER_DIM
	/// (Decision 4 - past the cap the transform upscales)
	rasterScale() {
		const { width, height } = this.getViewport();
		const cap = ZoomView.MAX_RASTER_DIM / Math.max(1, width, height);
		return Math.max(1, Math.min(this.scale, cap));
	}

	scheduleSettle() {
		this.cancelSettle();
		this.settleTimer = setTimeout(() => {
			this.settleTimer = null;
			this.onSettled(this.scale);
		}, ZoomView.SETTLE_MS);
	}

	cancelSettle() {
		if (this.settleTimer !== null) {
			clearTimeout(this.settleTimer);
			this.settleTimer = null;
		}
	}
}
