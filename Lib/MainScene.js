import Scene from "../GameSDK/Scene.js";
import Util from "../GameSDK/Util.js";
import Point from "../GameSDK/Geometry/Point.js";

export default class MainScene extends Scene {
	constructor(rootContainer) {
		super(rootContainer);
		this.display();
		this.isLoading = true;
	}

	resize() {
		this.canvas.width = window.innerWidth;
		this.canvas.height = window.innerHeight;
		if (this.currentAvastar) {
			this.parseAvastarSVG(this.currentAvastar);
		} else if (!this.isLoading) {
			this.isLoading = true;
			this.preloader.style.opacity = 1;
			this.loadAvastarSVG();
		}
	}

	display() {
		if (!this.canvas) {
			this.canvas = document.createElement("canvas");
			this.canvas.setAttribute("id", "mainCanvas");
			this.canvas.width = window.innerWidth;
			this.canvas.height = window.innerHeight;
			this.rootContainer.appendChild(this.canvas);
			this.displayLoop.start(60);
		}
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

		this.loadAvastarsContract(
			function () {
				this.loadAvastarSVG();
			}.bind(this)
		);
		// this.loadLocalAvastarSVG();
	}

	async loadAvastarsContract(complete) {
		const web3 = new Web3(window.ethereum);
		// await window.ethereum.enable();
		const contractAddress = "0xF3E778F839934fC819cFA1040AabaCeCBA01e049";
		let response = await fetch("./Lib/Avastars-ABI.json");
		let avastarsABI = await response.json();
		this.contract = new web3.eth.Contract(avastarsABI, contractAddress);
		complete();
	}

	async loadAvastarSVG() {
		const urlParams = new URLSearchParams(window.location.search);
		let tokenId = urlParams.get("tokenId");
		if (!tokenId) {
			// 25505 - Green
			// 25470 - Blue
			// 25495 - Pink Scale Check
			// 21022 - Orange Background Pink
			const avastars = [25495, 25470, 25505, 21022];
			tokenId = avastars[Util.getRandomInt(avastars.length - 1)];
		}
		this.contract.methods.renderAvastar(tokenId).call(
			function (error, result) {
				if (!error) {
					this.currentAvastar = result;
					this.parseAvastarSVG(result);
				} else {
					alert(`Avastar not found ${tokenId}`);
				}
			}.bind(this)
		);
	}

	async loadLocalAvastarSVG() {
		// 25505 - Green
		// 25470 - Blue
		// 25495 - Pink Scale Check
		// 21022 - Orange Background Pink
		const avastars = [25495, 25470, 25505, 21022];
		const randomAvastar = avastars[Util.getRandomInt(avastars.length - 1)];
		let myAvastar = await fetch(`./SVG/Avastar-${25505}.svg`);
		let svgString = await myAvastar.text();
		this.currentAvastar = svgString;
		this.parseAvastarSVG(svgString);
	}

	parseAvastarSVG(svgString) {
		this.parser = new DOMParser();
		this.avastarSVG = this.parser.parseFromString(svgString, "text/xml");

		this.styles = [];
		this.patterns = [];
		this.gradients = [];

		this.backgroundObjects = [];
		this.paths = [];

		const svgChildren = this.avastarSVG.children[0].children;
		for (const index in svgChildren) {
			const child = svgChildren[index];
			if (child.tagName === "style") {
				this.styles.push(child);
			} else if (this.objectIsBackground(child)) {
				this.backgroundObjects.push(child);
			} else if (child.tagName === "pattern") {
				this.patterns.push(child);
			} else if (child.tagName === "linearGradient") {
				this.gradients.push(child);
			} else if (child.tagName === "path" || child.tagName === "g") {
				this.paths.push(child);
			}
		}

		this.layers = [];
		for (const index in this.paths) {
			const path = this.paths[index];
			this.layers.push(this.pathsToLayer([path]));
		}

		this.backgroundLayer = this.pathsToLayer(this.backgroundObjects, true);

		const parser = new cssjs();
		this.styleObjects = [];
		for (const index in this.styles) {
			const style = this.styles[index].innerHTML;
			const parsed = parser.parseCSS(style);
			this.styleObjects.push(parsed);
		}

		this.layerPoints = [];
		for (const index in this.layers) {
			this.layerPoints.push(
				new Point(this.canvas.width / 2, this.canvas.height / 2)
			);
		}
		this.updateBackgroundColor();
		this.isLoading = false;
		this.preloader.style.opacity = 0;
	}

	objectIsBackground(item) {
		const isNode = item.getAttribute !== undefined;
		if (isNode && typeof item.getAttribute === "function") {
			const classString = item.getAttribute("class");
			const fillString = item.getAttribute("fill");
			if (classString && classString.includes("bg_")) {
				return true;
			}
			if (fillString && fillString.includes("backdrop")) {
				return true;
			}
			for (const index in item.children) {
				const child = item.children[index];
				const isBackground = this.objectIsBackground(child);
				if (isBackground) {
					return true;
				}
			}
		}
		return false;
	}

	updateBackgroundColor() {
		const contentView = document.getElementById("contentView");
		for (const index in this.styleObjects) {
			const styleObject = this.styleObjects[index];
			for (const styleIndex in styleObject) {
				const prop = styleObject[styleIndex];
				if (prop["selector"] === ".bg_color") {
					const rules = prop["rules"];
					for (const ruleIndex in rules) {
						const rule = rules[ruleIndex];
						if (rule["directive"] === "fill") {
							contentView.style.backgroundColor = rule["value"];
							return;
						}
					}
				}
			}
		}
	}

	nodeContents(node) {
		var tmp = document.createElement("div");
		tmp.appendChild(node);
		return tmp.innerHTML;
	}

	nodeArrayToString(nodes) {
		let string = "";
		for (const index in nodes) {
			const node = nodes[index];
			string += this.nodeContents(node);
		}
		return string;
	}

	pathsToLayer(paths, isBackground) {
		let svg = this.createHeader(isBackground);
		svg += this.nodeArrayToString(this.styles);
		svg += this.nodeArrayToString(this.gradients);
		svg += this.nodeArrayToString(this.patterns);
		for (const index in paths) {
			const path = paths[index];
			svg += this.nodeContents(path);
		}
		svg += "</svg>";
		let blob = new Blob([svg], { type: "image/svg+xml" });
		let url = URL.createObjectURL(blob);
		let image = new Image();
		image.src = url;
		image.addEventListener("load", () => URL.revokeObjectURL(url), {
			once: true,
		});
		return image;
	}

	createHeader(isBackground) {
		const svgXMLNS = `xmlns="http://www.w3.org/2000/svg"`;
		const xlinkXMLNS = `xmlns:xlink="http://www.w3.org/1999/xlink"`;
		const svgVersion = `version="1.1"`;
		if (isBackground) {
			const xmin = 0;
			const ymin = 0;
			const boxWidth = 1000;
			const boxHeight = 1000;
			const portWidth = "100%";
			const portHeight = "100%";

			const aspect = `preserveAspectRatio="xMidYMid meet"`;
			const viewPort = `width="${portWidth}" height="${portHeight}"`;
			const viewBox = `viewBox="${xmin} ${ymin} ${boxWidth} ${boxHeight}"`;
			return `<svg ${aspect} ${svgXMLNS} ${xlinkXMLNS} ${svgVersion} ${viewPort} ${viewBox}>`;
		} else {
			const aspect = `preserveAspectRatio="xMidYMid meet"`;
			const viewPort = `width="${this.canvas.width}" height="${this.canvas.height}"`;
			const viewBox = `viewBox="0 0 1000 1000"`;
			return `<svg ${aspect} ${svgXMLNS} ${xlinkXMLNS} ${svgVersion} ${viewPort} ${viewBox}>`;
		}
	}

	render() {
		const context = this.canvas.getContext("2d");
		context.clearRect(0, 0, this.canvas.width, this.canvas.height);
		if (this.isLoading) {
			return;
		}

		context.drawImage(
			this.backgroundLayer,
			0,
			0,
			this.canvas.width,
			this.canvas.height
		);

		let centerPoint = new Point(
			this.canvas.width / 2,
			this.canvas.height / 2
		);
		for (const index in this.layers) {
			const layer = this.layers[index];
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
				let newX = avastarPoint.x + toMouseX * factor;
				let newY = avastarPoint.y + toMouseY * factor;
				let newPoint = new Point(newX, newY);
				let distance = centerPoint.distanceTo(newPoint);
				avastarPoint.x += toMouseX * factor;
				avastarPoint.y += toMouseY * factor;
				this.layerPoints[index] = avastarPoint;
			} else {
				avastarPoint.x = centerPoint.x;
				avastarPoint.y = centerPoint.y;
				this.layerPoints[index] = avastarPoint;
			}
			context.drawImage(
				layer,
				avastarPoint.x - this.canvas.width / 2,
				avastarPoint.y - this.canvas.height / 2
			);
		}
	}
}
