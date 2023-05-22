import State from "./State.js";

/// Class used to represent the state of a sprite
export default class SpriteState extends State {
	/// Initialize a new state for the sprite
	///
	/// - Parameters:
	///		- identifier: The string idetifier for the state
	///		- sprite: The sprite the state should apply to
	///		- frameDelay: The delay to use when rendering each frame of the state
	constructor(identifier, sprite, frameDelay) {
		super(identifier, frameDelay);
		this.sprite = sprite;
		this.currentFrame = 0;
		this.animationIndex = 0;
		this.flipHorizontal = false;
	}

	/// Method used to render the sprite based on the current state
	render() {
		this.sprite.context.save();
		let drawPointX = this.sprite.drawPoint().x;
		if (this.flipHorizontal) {
			this.sprite.context.scale(-1, 1);
			drawPointX = drawPointX * -1 - this.sprite.frameSize;
		}
		this.sprite.context.drawImage(
			this.sprite.image,
			this.currentFrame * this.sprite.frameSize,
			this.animationIndex * this.sprite.frameSize,
			this.sprite.frameSize,
			this.sprite.frameSize,
			drawPointX,
			this.sprite.drawPoint().y,
			this.sprite.frameSize,
			this.sprite.frameSize
		);
		this.sprite.context.restore();
		super.render();
	}
}
