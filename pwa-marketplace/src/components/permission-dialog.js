class PermissionDialog {
    constructor() {
        this.element = this.createDialog();
    }

    createDialog() {
        const dialog = document.createElement('div');
        dialog.className = 'permission-dialog';
        dialog.style.display = 'none';

        // Create header
        const header = document.createElement('div');
        header.className = 'permission-header';
        
        const title = document.createElement('h2');
        title.textContent = 'Permission Request';
        header.appendChild(title);

        // Create close button
        const closeButton = document.createElement('button');
        closeButton.className = 'close-btn';
        closeButton.innerHTML = '&times;';
        closeButton.onclick = () => this.close();
        header.appendChild(closeButton);

        dialog.appendChild(header);

        // Create content
        const content = document.createElement('div');
        content.className = 'permission-content';

        // Create app info
        const appInfo = document.createElement('div');
        appInfo.className = 'app-info';

        const icon = document.createElement('img');
        icon.className = 'app-icon';
        icon.src = '/default-app-icon.png';
        appInfo.appendChild(icon);

        const appName = document.createElement('h3');
        appName.className = 'app-name';
        appName.textContent = 'App Name';
        appInfo.appendChild(appName);

        content.appendChild(appInfo);

        // Create permissions list
        const permissionsList = document.createElement('div');
        permissionsList.className = 'permissions-list';
        content.appendChild(permissionsList);

        // Create buttons
        const buttons = document.createElement('div');
        buttons.className = 'permission-buttons';

        const allowBtn = document.createElement('button');
        allowBtn.className = 'allow-btn primary-btn';
        allowBtn.textContent = 'Allow';
        allowBtn.onclick = () => this.allow();
        buttons.appendChild(allowBtn);

        const denyBtn = document.createElement('button');
        denyBtn.className = 'deny-btn secondary-btn';
        denyBtn.textContent = 'Deny';
        denyBtn.onclick = () => this.deny();
        buttons.appendChild(denyBtn);

        content.appendChild(buttons);
        dialog.appendChild(content);

        // Add to body
        document.body.appendChild(dialog);
        return dialog;
    }

    show(app, permissions) {
        // Update app info
        this.element.querySelector('.app-name').textContent = app.name;
        this.element.querySelector('.app-icon').src = app.iconUrl || '/default-app-icon.png';

        // Update permissions list
        const permissionsList = this.element.querySelector('.permissions-list');
        permissionsList.innerHTML = '';

        permissions.forEach(permission => {
            const item = document.createElement('div');
            item.className = 'permission-item';

            const icon = document.createElement('i');
            icon.className = 'material-icons';
            icon.textContent = 'lock';
            item.appendChild(icon);

            const description = document.createElement('span');
            description.textContent = permission.description;
            item.appendChild(description);

            permissionsList.appendChild(item);
        });

        // Show dialog
        this.element.style.display = 'flex';
    }

    close() {
        this.element.style.display = 'none';
    }

    allow() {
        // Send permission response to backend
        window.electron.mcp.send({
            type: 'permission_response',
            payload: {
                action: 'allow',
                timestamp: new Date().toISOString()
            }
        });
        this.close();
    }

    deny() {
        // Send permission response to backend
        window.electron.mcp.send({
            type: 'permission_response',
            payload: {
                action: 'deny',
                timestamp: new Date().toISOString()
            }
        });
        this.close();
    }

    static getInstance() {
        if (!PermissionDialog.instance) {
            PermissionDialog.instance = new PermissionDialog();
        }
        return PermissionDialog.instance;
    }
}

// Export the class
window.PermissionDialog = PermissionDialog;
