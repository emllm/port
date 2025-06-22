class AppCard {
    constructor(appData) {
        this.appData = appData;
        this.cardElement = null;
        this.iconElement = null;
        this.titleElement = null;
        this.descriptionElement = null;
        this.ratingElement = null;
        this.installButton = null;
        this.init();
    }

    init() {
        this.createCard();
        this.bindEvents();
    }

    createCard() {
        this.cardElement = document.createElement('div');
        this.cardElement.className = 'app-card bg-white rounded-lg shadow-md p-4 hover:shadow-lg transition-shadow';
        
        // Create icon container
        this.iconElement = document.createElement('div');
        this.iconElement.className = 'app-icon w-24 h-24 mx-auto mb-4';
        this.iconElement.style.backgroundImage = `url(${this.appData.icon || '/default-app-icon.svg'})`;
        this.iconElement.style.backgroundSize = 'contain';
        this.iconElement.style.backgroundRepeat = 'no-repeat';
        this.iconElement.style.backgroundPosition = 'center';
        
        // Create title
        this.titleElement = document.createElement('h3');
        this.titleElement.className = 'app-title text-lg font-semibold mb-2';
        this.titleElement.textContent = this.appData.name;
        
        // Create description
        this.descriptionElement = document.createElement('p');
        this.descriptionElement.className = 'app-description text-gray-600 mb-4';
        this.descriptionElement.textContent = this.appData.description || 'No description available';
        
        // Create rating
        this.ratingElement = document.createElement('div');
        this.ratingElement.className = 'app-rating flex items-center mb-4';
        this.ratingElement.innerHTML = `
            <span class="text-yellow-400">
                ${'★'.repeat(Math.floor(this.appData.rating || 0))}
                ${'☆'.repeat(5 - Math.floor(this.appData.rating || 0))}
            </span>
            <span class="ml-2">${this.appData.rating || 0}/5</span>
        `;
        
        // Create install button
        this.installButton = document.createElement('button');
        this.installButton.className = 'app-install-button px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors';
        this.installButton.textContent = this.appData.installed ? 'Open' : 'Install';
        
        // Append elements
        this.cardElement.appendChild(this.iconElement);
        this.cardElement.appendChild(this.titleElement);
        this.cardElement.appendChild(this.descriptionElement);
        this.cardElement.appendChild(this.ratingElement);
        this.cardElement.appendChild(this.installButton);
    }

    bindEvents() {
        this.installButton.addEventListener('click', () => {
            if (this.appData.installed) {
                this.handleOpenApp();
            } else {
                this.handleInstallApp();
            }
        });
    }

    handleInstallApp() {
        // Emit install event to parent component
        this.cardElement.dispatchEvent(new CustomEvent('install', {
            detail: {
                appId: this.appData.id,
                appName: this.appData.name
            }
        }));
    }

    handleOpenApp() {
        // Emit open event to parent component
        this.cardElement.dispatchEvent(new CustomEvent('open', {
            detail: {
                appId: this.appData.id,
                appName: this.appData.name
            }
        }));
    }

    updateState(isInstalled) {
        this.appData.installed = isInstalled;
        this.installButton.textContent = isInstalled ? 'Open' : 'Install';
    }

    setRating(rating) {
        this.appData.rating = rating;
        this.ratingElement.innerHTML = `
            <span class="text-yellow-400">
                ${'★'.repeat(Math.floor(rating))}
                ${'☆'.repeat(5 - Math.floor(rating))}
            </span>
            <span class="ml-2">${rating}/5</span>
        `;
    }

    get element() {
        return this.cardElement;
    }

    static create(appData) {
        return new AppCard(appData);
    }
}
