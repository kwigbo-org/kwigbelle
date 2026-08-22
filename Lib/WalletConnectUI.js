import { stopSceneEvents } from "./UIHelpers.js";

/// The upper left wallet button shown when the wallet needs a user
/// tap: to authorize the site or fix the network. Handles the
/// multi-wallet chooser and the connect flow; a successful connect
/// is reported through onConnected.
export default class WalletConnectUI {
	/// - Parameters:
	///		- rootContainer: The element to attach the button to
	///		- avastarLoader: The wallet integration to drive
	///		- onConnected: Called with the owned token ids once the
	///			wallet is connected on mainnet with Avastars
	constructor(rootContainer, avastarLoader, onConnected) {
		this.rootContainer = rootContainer;
		this.avastarLoader = avastarLoader;
		this.onConnected = onConnected;
	}

	/// Build and show the wallet button
	///
	/// - Parameter title: The label to show on the button
	show(title) {
		if (this.connectContainer) {
			return;
		}
		this.connectContainer = document.createElement("div");
		this.connectContainer.setAttribute("id", "walletConnect");
		stopSceneEvents(this.connectContainer);
		const button = document.createElement("div");
		button.setAttribute("class", "connectButton");
		button.innerText = title;
		button.addEventListener("click", this.connectWallet.bind(this));
		this.connectContainer.appendChild(button);
		this.rootContainer.appendChild(this.connectContainer);
	}

	/// Remove the button (and any open chooser) from the page
	remove() {
		if (this.connectContainer) {
			this.connectContainer.remove();
			this.connectContainer = null;
			this.walletList = null;
		}
	}

	/// Entry point for the wallet button: with several wallets
	/// installed show a chooser first, otherwise connect directly
	async connectWallet() {
		const wallets = await this.avastarLoader.getWallets();
		if (wallets.length > 1) {
			this.toggleWalletChooser(wallets);
			return;
		}
		this.continueConnect();
	}

	/// Expand or collapse the list of installed wallets under the
	/// wallet button. Picking one remembers it for future visits.
	///
	/// - Parameter wallets: The { info, provider } entries to list
	toggleWalletChooser(wallets) {
		if (this.walletList) {
			this.walletList.remove();
			this.walletList = null;
			return;
		}
		this.walletList = document.createElement("div");
		this.walletList.setAttribute("id", "walletList");
		for (const wallet of wallets) {
			const row = document.createElement("div");
			row.setAttribute("class", "walletRow");
			if (wallet.info && wallet.info.icon) {
				const icon = document.createElement("img");
				icon.src = wallet.info.icon;
				row.appendChild(icon);
			}
			const name = document.createElement("span");
			name.innerText = (wallet.info && wallet.info.name) || "Wallet";
			row.appendChild(name);
			row.addEventListener(
				"click",
				function () {
					this.avastarLoader.selectWallet(wallet);
					this.walletList.remove();
					this.walletList = null;
					this.continueConnect();
				}.bind(this),
			);
			this.walletList.appendChild(row);
		}
		this.connectContainer.appendChild(this.walletList);
	}

	/// Fix whatever the chosen wallet needs (from a user tap, which
	/// every wallet allows): switch to mainnet and/or connect, then
	/// hand the owned Avastars to the scene
	async continueConnect() {
		// Reentrancy guard: a second tap while the flow is mid
		// flight would run two connects and build two pickers
		if (this.isConnecting) {
			return;
		}
		this.isConnecting = true;
		try {
			// Wrong network: ask the wallet to switch. The page
			// reloads into the working state via the chainChanged
			// listener.
			const onMainnet = await this.avastarLoader.isMainnet();
			if (!onMainnet) {
				const switched = await this.avastarLoader.switchToMainnet();
				if (switched) {
					// Fallback for wallets that do not emit chainChanged
					window.location.reload();
				}
				return;
			}
			let ownedTokenIds = [];
			try {
				ownedTokenIds = await this.avastarLoader.getOwnedTokenIds(true);
			} catch (error) {
				console.error("Wallet connect failed", error);
				return;
			}
			if (ownedTokenIds.length === 0) {
				return;
			}
			this.remove();
			this.onConnected(ownedTokenIds);
		} finally {
			this.isConnecting = false;
		}
	}
}
