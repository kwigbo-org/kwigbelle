import Frame from "./Geometry/Frame.js";
import Point from "./Geometry/Point.js";
import Size from "./Geometry/Size.js";
import DisplayLoop from "./DisplayLoop.js";

/// Class used to represent a game scene
export default class Scene {
	/// Create a new scene tied to a dom element
	///
	/// - Parameter rootContainer: The DOM element the scene will use for display
	constructor(rootContainer) {
		this.touchFrame = new Frame(new Point(0, 0), new Size(64, 64));

		this.boundRender = this.render.bind(this);
		this.boundResize = this.resize.bind(this);
		this.displayLoop = new DisplayLoop(this.boundRender);
		this.rootContainer = rootContainer;
		this.boundTouchMove = this.touchMove.bind(this);
		this.boundTouchEnd = this.touchEnd.bind(this);
		this.boundTouchStart = this.touchStart.bind(this);
		this.boundMouseDown = this.mouseDown.bind(this);
		this.boundMouseUp = this.mouseUp.bind(this);
		this.boundMouseMove = this.mouseMove.bind(this);

		window.onresize = this.boundResize;
		window.addEventListener("touchstart", this.boundTouchStart, false);
		window.addEventListener("touchend", this.boundTouchEnd, false);
		window.addEventListener("touchmove", this.boundTouchMove, false);
		window.addEventListener("mousedown", this.boundMouseDown, false);
		window.addEventListener("mousemove", this.boundMouseMove, false);
		window.addEventListener("mouseup", this.boundMouseUp, false);
	}

	/// Mehtod to destroy the scene and all its events
	destroy() {
		this.displayLoop.stop();
		this.displayLoop = null;
		this.boundRender = null;
		this.rootContainer = null;
		window.removeEventListener("touchstart", this.boundTouchStart, false);
		window.removeEventListener("touchend", this.boundTouchEnd, false);
		window.removeEventListener("touchmove", this.boundTouchMove, false);
		window.removeEventListener("mousedown", this.boundMouseDown, false);
		window.removeEventListener("mousemove", this.boundMouseMove, false);
		window.removeEventListener("mouseup", this.boundMouseUp, false);
	}

	/// Method to override when the scene is resized
	resize() {}
	/// Method to override when the scene is rendered
	render() {}

	/// Method called when a touch moves in the scene
	///
	/// - Parameter event: The event that triggered the call
	touchMove(event) {
		this.touchFrame.origin = new Point(
			event.touches[0].clientX,
			event.touches[0].clientY
		);
	}

	/// Method called when a touch starts in the scene
	///
	/// - Parameter event: The event that triggered the call
	touchStart(event) {
		this.isTouchDown = true;
		this.touchFrame.origin = new Point(
			event.touches[0].clientX,
			event.touches[0].clientY
		);
	}

	/// Method called when a touch ends in the scene
	///
	/// - Parameter event: The event that triggered the call
	touchEnd() {
		this.isTouchDown = false;
		this.touchFrame.origin = new Point(0, 0);
	}

	/// Method called when a mouse is down in the scene
	///
	/// - Parameter event: The event that triggered the call
	mouseDown(event) {
		this.isTouchDown = true;
		this.touchFrame.origin = new Point(event.pageX, event.pageY);
	}

	/// Method called when a mouse is moved in the scene
	///
	/// - Parameter event: The event that triggered the call
	mouseMove(event) {
		this.touchFrame.origin = new Point(event.pageX, event.pageY);
	}

	/// Method called when a mouse is lifted in the scene
	///
	/// - Parameter event: The event that triggered the call
	mouseUp() {
		this.isTouchDown = false;
		this.touchFrame.origin = new Point(0, 0);
	}
}
