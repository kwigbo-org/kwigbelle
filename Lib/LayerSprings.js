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
		// Lock layers (docs/tads/info-tab.md Decision 4): when on,
		// every spring runs the same mid-depth profile - one target,
		// one set of dynamics - so the stack converges into lockstep
		// and the Avastar moves as ONE piece under drag, tilt, idle,
		// and poke. Springs keep their own state, so toggling eases
		// the layers together/apart instead of snapping. ON by
		// default (operator QA); a stored choice wins either way.
		this.isLockedTogether = true;
		this.lockProfile = LayerSprings.profileFor(0.5);
		this.springs = [];
	}

	/// The depth-tuned spring parameters. setup() hands each layer
	/// its own depth; the lock-layers mode runs every layer on the
	/// mid-depth profile.
	///
	/// Idle is depth-COHERENT (docs/tads/info-tab.md Decision 5):
	/// ONE shared breath with a SMALL depth lag - the face breathes
	/// as one being with parallax, instead of layers wandering on
	/// independent phases (the old lag of 2.4 rad decorrelated
	/// them). Raise the lag for more ripple, lower for lockstep;
	/// front layers breathe slightly deeper for depth.
	///
	/// - Parameter depth: Normalized depth 0 (back) to 1 (front)
	static profileFor(depth) {
		const stiffness = 90 - depth * 55;
		return {
			depth: depth,
			stiffness: stiffness,
			damping: 2 * Math.sqrt(stiffness) * 0.45,
			phase: depth * 0.9,
			swayAmp: 1 + depth * 4,
			breatheAmp: 2 + depth * 7.5,
		};
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
			// Locked-together layers share one profile so the whole
			// face takes the same kick and stays in lockstep
			const profile = this.isLockedTogether ? this.lockProfile : spring;
			let dx = spring.x - point.x;
			let dy = spring.y - point.y;
			const distance = Math.hypot(dx, dy);
			if (distance < 1) {
				// Tap dead-center on a resting layer: a stable
				// per-layer direction instead of dividing by zero
				const angle = profile.phase * 2.6;
				dx = Math.cos(angle);
				dy = Math.sin(angle);
			} else {
				dx /= distance;
				dy /= distance;
			}
			const strength = 250 + profile.depth * 550;
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
			this.springs.push({
				x: center.x,
				y: center.y,
				vx: 0,
				vy: 0,
				...LayerSprings.profileFor(depth),
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
			// Locked-together: every layer runs the mid-depth profile,
			// so targets and dynamics match and the stack converges
			// into moving as one piece
			const profile = this.isLockedTogether ? this.lockProfile : spring;
			// Resting target is the center, drifting on slow shared
			// sines so the Avastar "breathes" while idle (cadence and
			// lag per the Decision 5 retune - one-line tunables in
			// profileFor)
			let targetX =
				center.x +
				Math.sin(now * 0.45 + profile.phase) *
					profile.swayAmp *
					this.motionScale;
			let targetY =
				center.y +
				Math.sin(now * 0.7 + profile.phase) *
					profile.breatheAmp *
					this.motionScale;
			if (touchPoint) {
				// Front layers overshoot toward the pointer more than
				// back layers, separating them for a parallax feel -
				// locked-together, the shared reach erases exactly that
				// separation and the drag carries the whole face
				const reach = (1 + profile.depth * 0.35) * this.followScale;
				targetX = center.x + (touchPoint.x - center.x) * reach;
				targetY = center.y + (touchPoint.y - center.y) * reach;
			}
			if (this.isWaveEnabled) {
				// A traveling PULSE, not another sine: the idle
				// breathing is already a depth-staggered sine, so a
				// continuous wave read as "more of the same" (operator
				// QA). Every few seconds a wavefront sweeps the stack
				// back-to-front; each layer takes a quick out-and-back
				// whip as it passes, then rests until the next one.
				// Rides idle AND follow targets (a steady tilt drive
				// must not silence it) and is deliberately NOT scaled
				// by motionScale: Wave stands alone
				// (docs/tads/burned-traits.md Decision 10).
				const period = 3.2; // seconds between wavefronts
				const width = 0.4; // fraction of the period a layer whips
				// (locked-together, the front sweeps as one shared whip)
				let wavePhase = (now % period) / period - profile.depth * 0.35;
				if (wavePhase < 0) {
					wavePhase += 1;
				}
				if (wavePhase < width) {
					targetX += Math.sin((wavePhase / width) * Math.PI * 2) * 26;
				}
			}

			// Underdamped spring integration so layers overshoot
			// and settle instead of moving linearly
			const ax =
				(targetX - spring.x) * profile.stiffness - spring.vx * profile.damping;
			const ay =
				(targetY - spring.y) * profile.stiffness - spring.vy * profile.damping;
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
