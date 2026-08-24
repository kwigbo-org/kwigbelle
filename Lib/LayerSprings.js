/// The spring rig that moves an Avastar's layers independently.
/// Layer 0 is the deepest, the last layer is in front: front layers
/// get looser springs, larger breathing motion, and more reach
/// toward the pointer.
///
/// The effects settings (motion/follow scale, pause) are applied
/// at step() time - never by re-running setup() - so changing them
/// retunes the motion mid-flight instead of snapping every layer
/// back to center.
export default class LayerSprings {
	constructor() {
		// Effects settings (EffectsSection drives these)
		this.motionScale = 1;
		this.followScale = 1;
		this.isPaused = false;
		this.isWaveEnabled = false;
		this.springs = [];
	}

	/// Kick every layer's velocity away from a tap point — the Poke
	/// effect (docs/tads/burned-traits.md Decision 10). Front layers
	/// take the hardest hit; the underdamped springs scatter and
	/// settle on their own.
	///
	/// - Parameter point: Where the tap landed
	poke(point) {
		// A paused rig must not bank velocity for a burst on unpause
		if (this.isPaused) {
			return;
		}
		for (const spring of this.springs) {
			let dx = spring.x - point.x;
			let dy = spring.y - point.y;
			const distance = Math.hypot(dx, dy);
			if (distance < 1) {
				// Tap dead-center on a resting layer: a stable
				// per-layer direction instead of dividing by zero
				const angle = spring.phase * 2.6;
				dx = Math.cos(angle);
				dy = Math.sin(angle);
			} else {
				dx /= distance;
				dy /= distance;
			}
			const strength = 250 + spring.depth * 550;
			spring.vx += dx * strength;
			spring.vy += dy * strength;
		}
	}

	/// Build one spring per layer, all starting at rest on center
	///
	/// - Parameters:
	///		- layerCount: Number of layers in the current Avastar
	///		- center: The canvas center point springs start from
	setup(layerCount, center) {
		this.springs = [];
		for (let index = 0; index < layerCount; index++) {
			// Normalized depth 0 (back) to 1 (front): avastars can
			// slice into very different layer counts depending on
			// their traits, and raw index scaling made many layered
			// ones fly apart
			const depth = layerCount > 1 ? index / (layerCount - 1) : 0;
			const stiffness = 90 - depth * 55;
			this.springs.push({
				x: center.x,
				y: center.y,
				vx: 0,
				vy: 0,
				depth: depth,
				stiffness: stiffness,
				damping: 2 * Math.sqrt(stiffness) * 0.45,
				phase: depth * 2.4,
				swayAmp: 1 + depth * 3.5,
				breatheAmp: 2 + depth * 6.5,
			});
		}
	}

	/// Advance every spring by one frame
	///
	/// - Parameters:
	///		- dt: Clamped time step in seconds
	///		- now: Current time in seconds (drives the idle waves)
	///		- center: The resting center point
	///		- touchPoint: The pointer position while pressed, or
	///			null to breathe idly around the center
	step(dt, now, center, touchPoint) {
		if (this.isPaused) {
			return;
		}
		for (const spring of this.springs) {
			// Resting target is the center, drifting on slow sine
			// waves so the Avastar "breathes" while idle
			let targetX =
				center.x +
				Math.sin(now * 0.6 + spring.phase) * spring.swayAmp * this.motionScale;
			let targetY =
				center.y +
				Math.sin(now * 0.9 + spring.phase) *
					spring.breatheAmp *
					this.motionScale;
			if (touchPoint) {
				// Front layers overshoot toward the pointer more than
				// back layers, separating them for a parallax feel
				const reach = (1 + spring.depth * 0.35) * this.followScale;
				targetX = center.x + (touchPoint.x - center.x) * reach;
				targetY = center.y + (touchPoint.y - center.y) * reach;
			}
			if (this.isWaveEnabled) {
				// A ripple traveling through the layers by depth,
				// riding on idle AND follow targets — a steady tilt
				// drive must not silence it. Deliberately NOT scaled
				// by motionScale: Wave stands alone
				// (docs/tads/burned-traits.md Decision 10).
				targetX += Math.sin(now * 1.5 - spring.depth * 2.2) * 9;
			}

			// Underdamped spring integration so layers overshoot
			// and settle instead of moving linearly
			const ax =
				(targetX - spring.x) * spring.stiffness - spring.vx * spring.damping;
			const ay =
				(targetY - spring.y) * spring.stiffness - spring.vy * spring.damping;
			spring.vx += ax * dt;
			spring.vy += ay * dt;
			spring.x += spring.vx * dt;
			spring.y += spring.vy * dt;
		}
	}

	/// The current position of one layer's spring
	///
	/// - Parameter index: The layer index
	at(index) {
		return this.springs[index];
	}
}
