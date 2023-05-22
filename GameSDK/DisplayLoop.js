/// Class used to create a display loop
export default class DisplayLoop {
	/// Create a new display loop and pass a render function
	///
	/// - Parameter render: The function to call on each loop
	constructor(render) {
		this.boundLoop = this.loop.bind(this);
		this.render = render;
	}

	// Start the display loop with a given FPS
	///
	/// - Parameter fps: The Frames per second to loop
	start(fps) {
		this.fpsInterval = 1000 / fps;
		this.previousTime = Date.now();
		this.startTime = this.previousTime;
		this.loop();
		this.isRunning = true;
	}

	/// Stop the display loop
	stop() {
		window.cancelAnimationFrame(this.requestId);
		this.isRunning = false;
	}

	/// Main function that controlls the render call based on FPS
	loop() {
		this.requestId = window.requestAnimationFrame(this.boundLoop);

		this.currentTime = Date.now();
		this.elapsedTime = this.currentTime - this.previousTime;

		if (this.elapsedTime > this.fpsInterval) {
			this.previousTime =
				this.currentTime - (this.elapsedTime % this.fpsInterval);
			this.render();
		}
	}
}
