/// Class used to load an Avastar SVG from the blockchain
export default class AvastarLoader {
	/// Create a new loader and pass a token id
	constructor(tokenId) {
		this.tokenId = tokenId;
	}

	/// Method used to initialize the load of the Avastar tokenId
	///
	/// - Parameter complete: The method called when load is complete
	load(complete) {
		if (window.ethereum) {
			this.web3 = new Web3(window.ethereum);
			this.loadAvastarsContract(
				this.web3,
				function () {
					this.loadAvastarsMetaDataContract(
						this.web3,
						function () {
							this.loadOnChainAvastarSVG(complete);
							// this.loadAvastarMetaData(function () {});
						}.bind(this)
					);
				}.bind(this)
			);
		} else {
			this.loadLocalAvastarSVG(complete);
		}
	}

	/// Method used to load an Avastar from a local SVG
	///
	/// - Parameter complete: The Method called when the Avastar is loaded
	async loadLocalAvastarSVG(complete) {
		let myAvastar = await fetch(`./SVG/Avastar-${this.tokenId}.svg`);
		let svgString = await myAvastar.text();
		this.currentAvastar = svgString;
		complete();
	}

	/// Method used to load an Avastar from a the blockchain
	///
	/// - Parameter complete: The Method called when the Avastar is loaded
	async loadOnChainAvastarSVG(complete) {
		this.avastarContract.methods.renderAvastar(this.tokenId).call(
			function (error, result) {
				if (!error) {
					this.currentAvastar = result;
					complete(result);
				} else {
					alert(`Avastar not found ${this.tokenId}`);
				}
			}.bind(this)
		);
	}

	/// Load the Avastars Ethereum contract for use
	///
	/// - Parameters
	///		- web3: The web3 JS object to perform interactions with.
	///		- complete: The Method called when the contract is loaded.
	async loadAvastarsContract(web3, complete) {
		if (!this.web3) {
			compelete();
			return;
		}
		const contractAddress = "0xF3E778F839934fC819cFA1040AabaCeCBA01e049";
		let response = await fetch("./Lib/Avastars-ABI.json");
		let abi = await response.json();
		this.avastarContract = new web3.eth.Contract(abi, contractAddress);
		complete();
	}

	/// Load the Avastars Metadata Ethereum contract for use
	///
	/// - Parameters
	///		- web3: The web3 JS object to perform interactions with.
	///		- complete: The Method called when the contract is loaded.
	async loadAvastarsMetaDataContract(web3, complete) {
		if (!this.web3) {
			compelete();
			return;
		}
		const contractAddress = "0x40254e1920Bd1601dA1767D974CbB3e86967E30D";
		let response = await fetch("./Lib/AvastarsMetaData-ABI.json");
		let abi = await response.json();
		this.metaDataContract = new web3.eth.Contract(abi, contractAddress);
		complete();
	}

	/// Load the current Avastars metadata
	///
	/// - Parameters
	///		- web3: The web3 JS object to perform interactions with.
	///		- complete: The Method called when the contract is loaded.
	async loadAvastarMetaData(complete) {
		if (!this.web3) {
			return;
		}
		if (this.metaDataContract) {
			this.metaDataContract.methods
				.getAvastarMetadata(this.tokenId)
				.call(function (error, result) {
					console.log(result);
				});
		} else {
			this.loadAvastarsMetaDataContract(
				this.web3,
				function () {
					this.metaDataContract.methods
						.getAvastarMetadata(this.tokenId)
						.call(function (error, result) {
							console.log(result);
						});
				}.bind(this)
			);
		}
	}
}
