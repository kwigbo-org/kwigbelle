import Point from "./Geometry/Point.js";
import Frame from "./Geometry/Frame.js";
import Size from "./Geometry/Size.js";
import GridCoordinates from "./GridUtil/GridCoordinates.js";

/// Class used to represent a sprite drawn to a Canvas
export default class Sprite {
	/// Method to create a new Sprite
	///
	/// - Parameters:
	/// 	- image: The image source for the sprite
	///		- frameSize: The size of the frames in the sprite
	///		- canvas: The canvas to draw to
	///		- map: The map that contains the sprite
	///		- start: The start position of the sprite.
	constructor(image, frameSize, canvas, map, start) {
		this.image = image;
		this.frameSize = frameSize;
		this.canvas = canvas;
		this.map = map;
		this.currentPosition = start;
		this.currentDistance = 0;
		this.context = this.canvas.getContext("2d");
		this.debugFrameEnabled = false;
	}

	/// Frame that defines the position and size of the sprite
	get frame() {
		return new Frame(
			new Point(
				this.currentPosition.x - this.frameSize / 2,
				this.currentPosition.y - this.scaledSize / 2
			),
			new Size(this.frameSize, this.frameSize)
		);
	}

	/// Get the current coordinates for the sprite
	get currentCoordinates() {
		const centerPoint = new Point(
			this.frame.origin.x + this.frame.size.width / 2,
			this.frame.origin.y + this.frame.size.height / 2
		);
		return this.map.coordinatesForPoint(centerPoint);
	}

	/// Property used to check if the sprite is in the viewport
	get isOnscreen() {
		return this.frame.collided(this.map.viewPort);
	}

	/// Method used to render the sprite
	render() {
		if (this.debugFrameEnabled) {
			this.context.fillStyle = "rgba(255, 255, 255, 0.5)";
			this.context.fillRect(
				this.drawPoint().x,
				this.drawPoint().y,
				this.frameSize,
				this.frameSize
			);
		}
		if (this.stateMachine) {
			this.stateMachine.render();
		}
	}

	/// Method used to walk the sprite to a point in the map
	///
	/// - Parameter point: The point to move to
	moveTo(point) {
		let characterSpeed = 3;
		let pos = new Point(this.currentPosition.x, this.currentPosition.y);
		let mouse = point;
		let dx = mouse.x - pos.x;
		let dy = mouse.y - pos.y;
		this.currentDistance = Math.sqrt(dx * dx + dy * dy);
		if (this.currentDistance > 2) {
			let factor = this.currentDistance / characterSpeed;
			let xspeed = dx / factor;
			let yspeed = dy / factor;
			let newX = (pos.x += xspeed);
			let newY = (pos.y += yspeed);
			let newPosition = new Point(newX, newY);
			this.updatePosition(newPosition);
		} else {
			this.updatePosition(point);
		}
	}

	/// Method used to update the position of the player in the map
	///
	/// - Parameter newPosition: The position to move to
	updatePosition(newPosition) {
		let halfSize = this.frame.size.width / 2;
		let movePoint = new Point(newPosition.x, newPosition.y);
		if (this.currentPosition.x > newPosition.x) {
			movePoint.x -= halfSize;
		} else if (this.currentPosition.x < newPosition.x) {
			movePoint.x += halfSize;
		}
		if (this.currentPosition.y < newPosition.y) {
			movePoint.y += halfSize;
		}
		let coordinates = new GridCoordinates(
			Math.floor(movePoint.x / this.map.tileSize),
			Math.floor(movePoint.y / this.map.tileSize)
		);
		this.currentPosition = newPosition;
	}

	/// The current point at which the sprite should be drawn
	///
	/// - Returns: The point at which to draw at
	drawPoint() {
		let mapX = this.map.viewPort.origin.x;
		let mapY = this.map.viewPort.origin.y;
		let viewPortHalfWidth = this.map.viewPort.size.width / 2;
		let viewPortHalfHeight = this.map.viewPort.size.height / 2;
		let newX =
			this.currentPosition.x -
			mapX +
			this.canvas.width / 2 -
			viewPortHalfWidth -
			this.frameSize / 2;
		let newY =
			this.currentPosition.y -
			mapY +
			this.canvas.height / 2 -
			viewPortHalfHeight -
			this.frameSize / 2;
		return new Point(Math.floor(newX), Math.floor(newY));
	}
}
