import Scene from "../GameSDK/Scene.js";
import Util from "../GameSDK/Util.js";

export default class MainScene extends Scene {
	constructor(rootContainer) {
		super(rootContainer);
		this.display();
	}

	resize() {
		this.canvas.width = window.innerWidth;
		this.canvas.height = window.innerHeight;
		this.loadAvastarSVG();
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

		this.loadAvastarSVG();
	}

	async loadAvastarSVG() {
		const avastars = [25495, 25470, 25505, 21022];
		const randomAvastar = avastars[Util.getRandomInt(avastars.length - 1)];
		let myAvastar = await fetch(`./SVG/Avastar-${randomAvastar}.svg`);
		let svgString = await myAvastar.text();

		this.parser = new DOMParser();
		this.avastarSVG = this.parser.parseFromString(svgString, "text/xml");

		const svgChildren = this.avastarSVG.children[0].children;

		const paths = [];
		this.patterns = [];
		this.gradients = [];
		this.styles = [];
		for (const index in svgChildren) {
			const child = svgChildren[index];
			if (child.tagName === "path") {
				paths.push(child);
			} else if (child.tagName === "pattern") {
				this.patterns.push(child);
			} else if (child.tagName === "linearGradient") {
				this.gradients.push(child);
			} else if (child.tagName === "style") {
				this.styles.push(child);
			} else if (child.tagName === "g") {
				paths.push(child);
			}
		}

		const parser = new cssjs();
		this.styleObjects = [];
		for (const index in this.styles) {
			const style = this.styles[index].innerHTML;
			const parsed = parser.parseCSS(style);
			this.styleObjects.push(parsed);
		}

		this.layers = [];
		this.backgroundLayers = [];
		for (const index in paths) {
			const path = paths[index];
			const classString = path.getAttribute("class");
			const isBackgroundGroup = this.pathIsBackground(path);
			const isBackground = classString && classString.includes("bg_");
			const fillValue = path.getAttribute("fill");
			const isBackdrop = fillValue && fillValue.includes("backdrop");
			if (isBackground || isBackgroundGroup || isBackdrop) {
				this.backgroundLayers.push(this.pathToLayer(path, true));
			} else {
				this.layers.push(this.pathToLayer(path));
			}
		}
		this.updateBackgroundColor();
	}

	pathIsBackground(path) {
		for (const index in path.children) {
			const child = path.children[index];
			if (typeof child === "object") {
				const classString = child.getAttribute("class");
				const isBackground = classString && classString.includes("bg_");
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

	pathToLayer(path, isBackground) {
		const viewBox = `viewBox="0 0 1000 1000"`;
		const viewPort = isBackground
			? `width="100%" height="100%"`
			: `width="${this.canvas.width}" height="${this.canvas.height}"`;
		let svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" ${viewPort} ${viewBox}>`;
		svg += this.nodeArrayToString(this.styles);
		svg += this.nodeArrayToString(this.gradients);
		svg += this.nodeArrayToString(this.patterns);
		svg += this.nodeContents(path);
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

	render() {
		const context = this.canvas.getContext("2d");
		context.clearRect(0, 0, this.canvas.width, this.canvas.height);
		for (const index in this.backgroundLayers) {
			const layer = this.backgroundLayers[index];
			context.drawImage(
				layer,
				0,
				0,
				this.canvas.width,
				this.canvas.height
			);
		}
		for (const index in this.layers) {
			const layer = this.layers[index];
			context.drawImage(layer, 0, 0);
		}
	}
}
