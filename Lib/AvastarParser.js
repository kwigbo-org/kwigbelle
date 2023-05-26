/// Class used to parse an on chain Avastar SVG
export default class AvastarParser {
	/// Initialize a parser
	///
	/// - Parameters:
	///		- svgString: The SVG string to create the parse with
	///		- displaySize: The size the SVG parser should setup for display in
	constructor(svgString, displaySize) {
		this.svgString = svgString;
		this.displaySize = displaySize;
		this.debug = false;
	}

	slice(elements, start, end) {
		return Array.prototype.slice.call(elements, start, end);
	}

	/// Trigger the parser of the loaded SVG string
	parse() {
		const parser = new DOMParser();
		const dom = parser.parseFromString(this.svgString, "text/xml");
		const svgChildren = dom.children[0].children;

		let referenceNodes = this.nodeWithReference(svgChildren);

		let searchLayers = [
			["style"],
			["bg", "backdrop"],
			["skin", "ear"],
			["face", "skin"],
			["nose", "skin"],
			["mouth", "skin"],
			["feat"],
			["eye", "skin", "hair_brow"],
			["hair"],
		];

		this.renderPaths = [];
		let searchKeysIndex = 0;
		let lastStartIndex = 0;
		for (let index in referenceNodes) {
			const searchKeys = searchLayers[searchKeysIndex];
			const reference = referenceNodes[index];
			if (!this.objectIsOfType(reference, searchKeys)) {
				const sliced = this.slice(
					svgChildren,
					lastStartIndex,
					reference.index
				);
				if (this.debug) {
					console.log(`=============`);
					console.log("++ Slicing Layer ++");
					console.log(searchKeys);
					console.log(`startIndex: ${lastStartIndex}`);
					console.log(`endIndex: ${reference.index - 1}`);
					console.log(`Path Length: ${sliced.length}`);
				}
				this.renderPaths.push(sliced);
				lastStartIndex = reference.index;
				searchKeysIndex++;
			}
		}

		// Final slice
		const sliced = this.slice(
			svgChildren,
			lastStartIndex,
			svgChildren.length
		);
		this.renderPaths.push(sliced);

		if (this.debug) {
			const searchKeys = searchLayers[searchKeysIndex];
			console.log(`=============`);
			console.log("++ Slicing Layer ++");
			console.log(searchKeys);
			console.log(`startIndex: ${lastStartIndex}`);
			console.log(`endIndex: ${svgChildren.length - 1}`);
			console.log(`Path Length: ${sliced.length}`);
		}

		if (this.debug) {
			let nodeCount = 0;
			for (const index in this.renderPaths) {
				const renderPath = this.renderPaths[index];
				for (const pathIndex in renderPath) {
					nodeCount++;
				}
			}
			console.log(`=============`);
			console.log("++ Validating Node Count ++");
			console.log(`Total Children: ${svgChildren.length}`);
			console.log(`Total Render Nodes: ${nodeCount}`);
		}

		// Get styles

		this.styles = this.renderPaths[0];

		// Get backgrounds
		this.backgroundLayer = this.pathsToLayer(this.renderPaths[1], true);

		// Get foreground layers
		this.layers = [];
		for (const index in this.renderPaths) {
			if (index > 1) {
				const path = this.renderPaths[index];
				this.layers.push(this.pathsToLayer(path));
			}
		}

		// Parse CSS and get any relevant settings

		const cssParser = new cssjs();
		this.styleObjects = [];
		for (const index in this.styles) {
			const style = this.styles[index].innerHTML;
			const parsed = cssParser.parseCSS(style);
			this.styleObjects.push(parsed);
		}
		this.setSVGStyles();
	}

	/// Check if a given object is of a type in the given list
	///
	/// - Parameters:
	///		- object: The object to check the type for
	///		- typeList: The list to compare the object against
	objectIsOfType(object, typeList) {
		for (const index in typeList) {
			const type = typeList[index];
			if (object.key.includes(type) || object.tagName === type) {
				return true;
			}
		}
		return false;
	}

	/// Get all use nodes that have a class defined
	///
	/// - Parameter node: The node to traverse and find use nodes
	nodeWithReference(nodes, markerIndex) {
		let returnNodes = [];
		for (const index in nodes) {
			const node = nodes[index];
			const isNode = node.getAttribute !== undefined;
			if (isNode && typeof node.getAttribute === "function") {
				const classString = node.getAttribute("class");
				const idString = node.getAttribute("id");
				let currentIndex = markerIndex ? markerIndex : index;
				if (classString) {
					returnNodes.push({
						key: classString,
						index: currentIndex,
						node: node,
					});
				}
				if (idString) {
					returnNodes.push({
						key: idString,
						index: currentIndex,
						node: node,
					});
				}
				if (node.children && node.children.length > 0) {
					returnNodes = returnNodes.concat(
						this.nodeWithReference(node.children, currentIndex)
					);
				}
			}
		}
		return returnNodes;
	}

	/// Used to get the string contents of a node
	///
	/// - Parameter object: The object to get the value for
	/// - Returns: The string value of the given object or empty string.
	nodeContents(object) {
		const isNode = object.getAttribute !== undefined;
		if (isNode && typeof object.getAttribute === "function") {
			var tmp = document.createElement("div");
			tmp.appendChild(object);
			return tmp.innerHTML;
		}
		return "";
	}

	/// Used to get the string of an array of nodes
	///
	/// - Parameter nodes: The nodes to get the string value of
	/// - Returns: The string value of the given nodes or empty string.
	nodeArrayToString(nodes) {
		let string = "";
		for (const index in nodes) {
			const node = nodes[index];
			string += this.nodeContents(node);
		}
		return string;
	}

	/// Converts an array of paths to a new SVG file for rendering
	///
	/// - Parameters:
	///		- paths: Array of paths to convert to new SVG files
	///		- isBackground: Is this a background layer?
	///			Background layers are rendered differently to stretch and fill
	///	- Returns: The image object created from the paths.
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

	/// Creates an SVG header based on depth of rendered layers
	///
	///		- isBackground: Is this a background layer?
	///			Background layers are rendered differently to stretch and fill
	///	- Returns: The string value for the SVG header.
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
			const viewPort = `width="${this.displaySize.width}" height="${this.displaySize.height}"`;
			const viewBox = `viewBox="0 0 1000 1000"`;
			return `<svg ${aspect} ${svgXMLNS} ${xlinkXMLNS} ${svgVersion} ${viewPort} ${viewBox}>`;
		}
	}

	/// Grab the styles from the SVG file and set any needed for displaye
	setSVGStyles() {
		for (const index in this.styleObjects) {
			const styleObject = this.styleObjects[index];
			for (const styleIndex in styleObject) {
				const prop = styleObject[styleIndex];
				if (prop["selector"] === ".bg_color") {
					const rules = prop["rules"];
					for (const ruleIndex in rules) {
						const rule = rules[ruleIndex];
						if (rule["directive"] === "fill") {
							this.backgroundColor = rule["value"];
						}
					}
				}
			}
		}
	}
}
