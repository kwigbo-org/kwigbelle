/// Class used to scale image assets before rendering
export default class AssetScaler {
	/// Initializer for an asset scaler
	/// Creates a canvas object to draw and resize images
	constructor() {
		this.canvas = document.createElement("canvas");
		this.context = this.canvas.getContext("2d");
		this.context.imageSmoothingEnabled = false;
	}

	/// Scale a given image
	///
	/// - Parameters:
	///		- image: The image to scale.
	///		- scale: The amount to scale by
	///		- complete: The function called when scaling is complete
	scaleImage(image, scale, complete) {
		image.onload = function () {
			this.canvas.width = image.width * scale;
			this.canvas.height = image.height * scale;
			let tempContext = this.canvas.getContext("2d");
			tempContext.imageSmoothingEnabled = false;
			tempContext.clearRect(0, 0, this.canvas.width, this.canvas.height);
			tempContext.drawImage(
				image,
				0,
				0,
				image.width,
				image.height,
				0,
				0,
				image.width * scale,
				image.height * scale
			);
			let scaledImage = new Image();
			scaledImage.src = this.canvas.toDataURL("image/png");
			scaledImage.onload = function () {
				complete(scaledImage);
			};
		}.bind(this);
	}
}
