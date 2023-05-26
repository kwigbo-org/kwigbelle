import Scene from "../GameSDK/Scene.js";
import Util from "../GameSDK/Util.js";
import Size from "../GameSDK/Geometry/Size.js";
import Point from "../GameSDK/Geometry/Point.js";
import AvastarParser from "./AvastarParser.js";
import AvastarLoader from "./AvastarLoader.js";

/// Class used to represent the Avastars scene
export default class MainScene extends Scene {
	/// Overridden constructor
	constructor(rootContainer) {
		super(rootContainer);
		// Build the UI
		this.buildUI();
		// Start loading
		this.isLoading = true;
		// Check url params for a "tokenId"
		const urlParams = new URLSearchParams(
			window.location.search.toLowerCase()
		);
		let tokenId = urlParams.get("tokenid");
		this.isParserDebugEnabled = urlParams.get("parserdebug");
		this.isExplodeEnabled = urlParams.get("explode");
		if (!tokenId || !window.ethereum) {
			// If not parameter use a random kwigbelle avastar
			const avastars = [8014, 25495, 25470, 25505, 21022];
			tokenId = avastars[Util.getRandomInt(avastars.length - 1)];
		}
		// Object used to load the Avastar SVG from on chain
		this.avastarLoader = new AvastarLoader(tokenId);
		this.avastarLoader.load(
			function () {
				// Parse the Avastar and prepare for display
				this.parseAvastarSVG();
				this.isLoading = false;
				this.preloader.style.opacity = 0;
			}.bind(this)
		);
	}

	// MARK: Overridden Methods

	resize() {
		this.canvas.width = window.innerWidth;
		this.canvas.height = window.innerHeight;
		/// Reparse
		this.parseAvastarSVG();
	}

	render() {
		const context = this.canvas.getContext("2d");
		context.clearRect(0, 0, this.canvas.width, this.canvas.height);
		if (this.isLoading) {
			return;
		}

		context.drawImage(
			this.avastar.backgroundLayer,
			0,
			0,
			this.canvas.width,
			this.canvas.height
		);

		let centerPoint = new Point(
			this.canvas.width / 2,
			this.canvas.height / 2
		);
		for (const index in this.avastar.layers) {
			const layer = this.avastar.layers[index];
			let touchPoint = this.touchFrame.origin;
			if (!this.isTouchDown) {
				touchPoint = centerPoint;
			}
			const avastarPoint = this.layerPoints[index];
			// Calculate direction towards mouse
			let toMouseX = Math.floor(touchPoint.x - avastarPoint.x);
			let toMouseY = Math.floor(touchPoint.y - avastarPoint.y);

			if (Math.abs(toMouseX) > 1 || Math.abs(toMouseY) > 1) {
				// Normalize
				let toMouseLength = Math.sqrt(
					toMouseX * toMouseX + toMouseY * toMouseY
				);
				toMouseX = toMouseX / toMouseLength;
				toMouseY = toMouseY / toMouseLength;

				let factor = 3;
				if (this.isExplodeEnabled) {
					factor = 3 * ((index + 2) * 0.01);
				}
				let newX = avastarPoint.x + toMouseX * factor;
				let newY = avastarPoint.y + toMouseY * factor;
				let newPoint = new Point(newX, newY);
				let distance = centerPoint.distanceTo(newPoint);
				avastarPoint.x += toMouseX * factor;
				avastarPoint.y += toMouseY * factor;
				this.layerPoints[index] = avastarPoint;
			}
			context.drawImage(
				layer,
				avastarPoint.x - this.canvas.width / 2,
				avastarPoint.y - this.canvas.height / 2
			);
		}
	}

	// "Private Methods"

	/// Method to build the UI needed for this scene
	buildUI() {
		// Main canvas
		this.canvas = document.createElement("canvas");
		this.canvas.setAttribute("id", "mainCanvas");
		this.canvas.width = window.innerWidth;
		this.canvas.height = window.innerHeight;
		this.rootContainer.appendChild(this.canvas);
		this.displayLoop.start(60);

		// Preloader Container
		this.preloader = document.createElement("div");
		this.preloader.setAttribute("id", "preloader");
		this.preloader.setAttribute("class", "centeredContainer");

		// Spinner
		const spinner = document.createElement("div");
		spinner.setAttribute("class", "lds-circle");
		const innerDiv = document.createElement("div");
		spinner.appendChild(innerDiv);
		this.preloader.appendChild(spinner);

		this.rootContainer.appendChild(this.preloader);
	}

	/// Method used to trigger the parse of the currently loaded avastar.
	parseAvastarSVG() {
		// Check the avastar loader for an Avastar
		const svgString = this.avastarLoader.currentAvastar;
		if (!svgString) {
			// TODO: Handle this failure
			return;
		}
		// Create a new AvastarParser and pass in the currently loaded Avastar
		this.avastar = new AvastarParser(
			svgString,
			new Size(this.canvas.width, this.canvas.height)
		);
		this.avastar.debug = this.isParserDebugEnabled;
		// Parse the Avastar SVG
		this.avastar.parse();

		const contentView = document.getElementById("contentView");
		// Get the background color from the Avastar Parser
		contentView.style.backgroundColor = this.avastar.backgroundColor;

		// Setup a movement tracking point for each layer.
		// This allows for independent movement of each layer.
		this.layerPoints = [];
		for (const index in this.avastar.layers) {
			this.layerPoints.push(
				new Point(this.canvas.width / 2, this.canvas.height / 2)
			);
		}
	}
}
