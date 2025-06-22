class AppCard {
    constructor(app) {
        this.app = app;
        this.element = this.createCard();
    }

    createCard() {
        const card = document.createElement('div');
        card.className = 'app-card';

        // Create icon container
        const iconContainer = document.createElement('div');
        iconContainer.className = 'app-icon-container';
        
        // Create icon
        const icon = document.createElement('img');
        icon.className = 'app-icon';
        icon.src = this.app.iconUrl || '/default-app-icon.png';
        icon.alt = this.app.name;
        iconContainer.appendChild(icon);

        // Create content container
        const content = document.createElement('div');
        content.className = 'app-content';

        // Create name
        const name = document.createElement('h3');
        name.className = 'app-name';
        name.textContent = this.app.name;
        content.appendChild(name);

        // Create description
        if (this.app.description) {
            const description = document.createElement('p');
            description.className = 'app-description';
            description.textContent = this.app.description;
            content.appendChild(description);
        }

        // Create category
        if (this.app.category) {
            const category = document.createElement('span');
            category.className = 'app-category';
            category.textContent = this.app.category;
            content.appendChild(category);
        }

        // Create actions container
        const actions = document.createElement('div');
        actions.className = 'app-actions';

        // Create install button
        const installBtn = document.createElement('button');
        installBtn.className = 'install-btn';
        installBtn.textContent = 'Install';
        installBtn.onclick = () => this.handleInstall();
        actions.appendChild(installBtn);

        // Create uninstall button (if installed)
        if (this.app.isInstalled) {
            const uninstallBtn = document.createElement('button');
            uninstallBtn.className = 'uninstall-btn';
            uninstallBtn.textContent = 'Uninstall';
            uninstallBtn.onclick = () => this.handleUninstall();
            actions.appendChild(uninstallBtn);
        }

        // Add all elements to card
        card.appendChild(iconContainer);
        card.appendChild(content);
        card.appendChild(actions);

        return card;
    }

    handleInstall() {
        // Send install request to backend
        window.electron.mcp.send({
            type: 'install',
            payload: {
                id: this.app.id,
                manifestUrl: this.app.manifestUrl,
                permissions: this.app.permissions
            }
        });
    }

    handleUninstall() {
        // Send uninstall request to backend
        window.electron.mcp.send({
            type: 'uninstall',
            payload: { id: this.app.id }
        });
    }

    update(app) {
        this.app = app;
        this.element.querySelector('.app-name').textContent = app.name;
        if (app.description) {
            this.element.querySelector('.app-description').textContent = app.description;
        }
        if (app.category) {
            this.element.querySelector('.app-category').textContent = app.category;
        }
        this.element.querySelector('.app-icon').src = app.iconUrl || '/default-app-icon.png';
        
        // Update buttons based on installation status
        const actions = this.element.querySelector('.app-actions');
        actions.innerHTML = '';

        const installBtn = document.createElement('button');
        installBtn.className = 'install-btn';
        installBtn.textContent = 'Install';
        installBtn.onclick = () => this.handleInstall();
        actions.appendChild(installBtn);

        if (app.isInstalled) {
            const uninstallBtn = document.createElement('button');
            uninstallBtn.className = 'uninstall-btn';
            uninstallBtn.textContent = 'Uninstall';
            uninstallBtn.onclick = () => this.handleUninstall();
            actions.appendChild(uninstallBtn);
        }
    }

    get element() {
        return this._element;
    }

    set element(value) {
        this._element = value;
    }
}

// Export the class
window.AppCard = AppCard;
