/// Class used to load an Avastar SVG from the blockchain
export default class AvastarLoader {
	/// Token ids with SVGs bundled in SVG/ — the offline fallback
	/// data (deploy.sh ships the SVG/ directory)
	static BUNDLED_TOKEN_IDS = [8014, 25495, 25470, 25505, 21022];

	/// Create a new loader and pass a token id
	constructor(tokenId) {
		this.tokenId = tokenId;
		// Collect wallets that announce themselves via EIP-6963.
		// With several wallet extensions installed window.ethereum
		// is contested (one extension overwrites another), so the
		// announced providers are the reliable way to find a wallet.
		this.announcedProviders = [];
		window.addEventListener("eip6963:announceProvider", (event) => {
			const detail = event.detail;
			// Wallets re-announce on every requestProvider dispatch:
			// dedupe at insertion so the list stays bounded
			const isDuplicate = this.announcedProviders.some(
				(existing) =>
					existing.provider === detail.provider ||
					(detail.info &&
						detail.info.uuid &&
						existing.info &&
						existing.info.uuid === detail.info.uuid),
			);
			if (!isDuplicate) {
				this.announcedProviders.push(detail);
			}
		});
		window.dispatchEvent(new Event("eip6963:requestProvider"));
	}

	/// List the available wallets: the EIP-6963 announced wallets
	/// (deduped) plus the legacy window.ethereum as a fallback.
	///
	/// - Returns: Array of { info, provider } wallet entries
	async getWallets() {
		// Give extensions a moment to announce themselves
		if (!this.announceWaitDone) {
			await new Promise((resolve) => setTimeout(resolve, 300));
			this.announceWaitDone = true;
		}
		const wallets = [...this.announcedProviders];
		if (
			window.ethereum &&
			!wallets.some((wallet) => wallet.provider === window.ethereum)
		) {
			wallets.push({
				info: { name: "Browser Wallet", rdns: "window.ethereum" },
				provider: window.ethereum,
			});
		}
		return wallets;
	}

	/// The storage key remembering which wallet the user picked
	walletKey(info) {
		return (info && (info.rdns || info.name)) || "";
	}

	/// Use a specific wallet from here on and remember the choice
	/// for future visits
	///
	/// - Parameter wallet: A { info, provider } entry from getWallets
	selectWallet(wallet) {
		this.provider = wallet.provider;
		// The contract and any in-flight connect are bound to the
		// previous provider
		this.avastarContract = null;
		this.web3 = null;
		this.connectPromise = null;
		this.watchChain(this.provider);
		try {
			localStorage.setItem("kwigbelle.wallet", this.walletKey(wallet.info));
		} catch (error) {
			// Storage unavailable: the choice just won't persist
		}
	}

	/// The user chose to log out: forget the remembered wallet, drop
	/// the active provider and its bound contract state, and record
	/// the choice so a reload does not silently reconnect
	forgetWallet() {
		this.provider = undefined;
		this.avastarContract = null;
		this.web3 = null;
		this.connectPromise = null;
		try {
			localStorage.removeItem("kwigbelle.wallet");
			localStorage.setItem("kwigbelle.disconnected", "1");
		} catch (error) {
			// Storage unavailable: the logout just won't persist
		}
	}

	/// Whether the user logged out (suppresses the silent
	/// enumeration on page load)
	isLoggedOut() {
		try {
			return localStorage.getItem("kwigbelle.disconnected") === "1";
		} catch (error) {
			return false;
		}
	}

	/// A connect tap ends the logged-out state
	clearLoggedOut() {
		try {
			localStorage.removeItem("kwigbelle.disconnected");
		} catch (error) {}
	}

	/// Reload on network switches (e.g. Base -> mainnet) so the
	/// wallet's Avastars appear without a manual refresh
	watchChain(provider) {
		if (provider && provider.on && this.watchedProvider !== provider) {
			this.watchedProvider = provider;
			provider.on("chainChanged", () => window.location.reload());
		}
	}

	/// Resolve which wallet provider to use. A wallet the user
	/// picked before wins. Otherwise candidates are scored so an
	/// authorized mainnet wallet beats an authorized one on another
	/// chain, which beats an unauthorized mainnet one.
	///
	/// - Returns: A provider, or null when no wallet is available
	async getProvider() {
		if (this.provider !== undefined) {
			return this.provider;
		}
		const wallets = await this.getWallets();
		// Honor a previously picked wallet
		let stored = null;
		try {
			stored = localStorage.getItem("kwigbelle.wallet");
		} catch (error) {}
		if (stored) {
			const match = wallets.find(
				(wallet) => this.walletKey(wallet.info) === stored,
			);
			if (match) {
				this.provider = match.provider;
				this.watchChain(this.provider);
				return this.provider;
			}
		}
		let best = null;
		let bestScore = -1;
		for (const wallet of wallets) {
			let score = 0;
			try {
				const accounts = await wallet.provider.request({
					method: "eth_accounts",
				});
				if (accounts && accounts.length > 0) {
					score += 2;
				}
				const chainId = await wallet.provider.request({
					method: "eth_chainId",
				});
				if (parseInt(chainId, 16) === 1) {
					score += 1;
				}
			} catch (error) {
				// Unresponsive wallet: score stays low
			}
			if (score > bestScore) {
				bestScore = score;
				best = wallet.provider;
			}
		}
		this.provider = best;
		this.watchChain(this.provider);
		return this.provider;
	}

	/// - Returns: True when any wallet provider is available
	async hasWallet() {
		return (await this.getProvider()) !== null;
	}

	/// - Returns: True when the chosen wallet reports mainnet
	async isMainnet() {
		const provider = await this.getProvider();
		if (!provider) {
			return false;
		}
		try {
			const chainId = await provider.request({
				method: "eth_chainId",
			});
			return parseInt(chainId, 16) === 1;
		} catch (error) {
			return false;
		}
	}

	/// Ask the wallet to switch this site to mainnet. On success
	/// the chainChanged listener reloads the page.
	///
	/// - Returns: True when the wallet accepted the switch
	async switchToMainnet() {
		const provider = await this.getProvider();
		if (!provider) {
			return false;
		}
		try {
			await provider.request({
				method: "wallet_switchEthereumChain",
				params: [{ chainId: "0x1" }],
			});
			return true;
		} catch (error) {
			console.error("Network switch declined", error);
			return false;
		}
	}

	/// One time setup of web3 and the Avastars contract.
	/// Safe to call repeatedly and concurrently: callers share a
	/// single in-flight initialization. The contract only lives on
	/// mainnet, so any other chain is treated the same as having
	/// no wallet at all.
	///
	/// - Returns: True when a mainnet wallet is available and the
	///		contract is ready
	connect() {
		if (!this.connectPromise) {
			this.connectPromise = this.establishConnection().catch((error) => {
				// Allow a retry after a failed initialization
				this.connectPromise = null;
				throw error;
			});
		}
		return this.connectPromise;
	}

	/// The actual initialization behind connect()
	async establishConnection() {
		const provider = await this.getProvider();
		if (!provider) {
			return false;
		}
		if (this.avastarContract) {
			return true;
		}
		const chainId = await provider.request({
			method: "eth_chainId",
		});
		if (parseInt(chainId, 16) !== 1) {
			console.warn(
				`Wallet is on chain ${chainId}, Avastars lives on mainnet (0x1). Using local SVGs.`,
			);
			return false;
		}
		this.web3 = new Web3(provider);
		const contractAddress = "0xF3E778F839934fC819cFA1040AabaCeCBA01e049";
		const response = await fetch("./Lib/Avastars-ABI.json");
		const abi = await response.json();
		this.avastarContract = new this.web3.eth.Contract(abi, contractAddress);
		return true;
	}

	/// Fetch the best available full-render SVG for a token, used
	/// when trait composition fails: the on-chain render when a
	/// mainnet wallet is connected, else a bundled SVG (substituting
	/// a random bundled Avastar when the exact token has none).
	/// Callers display the result as a single static layer — nothing
	/// slices it.
	///
	/// - Parameter tokenId: The token id to fetch
	/// - Returns: The SVG string
	async fallbackSVG(tokenId) {
		try {
			if (await this.connect()) {
				return await this.renderTokenSVG(tokenId);
			}
		} catch (error) {
			console.error(`On chain render failed for Avastar ${tokenId}`, error);
		}
		let response = await fetch(`./SVG/Avastar-${tokenId}.svg`);
		if (!response.ok) {
			const bundled = AvastarLoader.BUNDLED_TOKEN_IDS;
			const randomId = bundled[Math.floor(Math.random() * bundled.length)];
			console.warn(
				`No SVG available for ${tokenId}, showing bundled Avastar ${randomId}`,
			);
			response = await fetch(`./SVG/Avastar-${randomId}.svg`);
		}
		if (!response.ok) {
			throw new Error(`no fallback SVG for ${tokenId}`);
		}
		return response.text();
	}

	/// Render a token's SVG from the contract without changing
	/// the currently loaded Avastar. Used for picker thumbnails.
	///
	/// - Parameter tokenId: The token id to render
	/// - Returns: The SVG string for the token
	async renderTokenSVG(tokenId) {
		const connected = await this.connect();
		if (!connected) {
			throw new Error("No mainnet wallet available");
		}
		return this.avastarContract.methods.renderAvastar(tokenId).call();
	}

	/// List the Avastar token ids owned by the connected wallet.
	///
	/// - Parameter allowPrompt: When true and the site has no
	///		account yet, ask the wallet to show its connect prompt.
	///		Some wallets only allow this from a user tap.
	/// - Returns: Array of owned token id strings, empty when no
	///		wallet/account is available or it owns no Avastars
	async getOwnedTokenIds(allowPrompt) {
		const connected = await this.connect();
		if (!connected) {
			return [];
		}
		let accounts = await this.provider.request({
			method: "eth_accounts",
		});
		if ((!accounts || accounts.length === 0) && allowPrompt) {
			accounts = await this.provider.request({
				method: "eth_requestAccounts",
			});
		}
		if (!accounts || accounts.length === 0) {
			return [];
		}
		const owner = accounts[0];
		const balance = await this.avastarContract.methods.balanceOf(owner).call();
		// Pure reads: safe to fetch in parallel so large
		// collections don't serialize wallet round-trips
		const indexes = Array.from({ length: Number(balance) }, (_, i) => i);
		const tokenIds = await Promise.all(
			indexes.map((index) =>
				this.avastarContract.methods.tokenOfOwnerByIndex(owner, index).call(),
			),
		);
		return tokenIds.map((tokenId) => tokenId.toString());
	}
}
