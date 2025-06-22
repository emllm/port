class PermissionDialog {
    constructor(appData, permissions) {
        this.appData = appData;
        this.permissions = permissions;
        this.dialogElement = null;
        this.permissionElements = new Map();
        this.init();
    }

    init() {
        this.createDialog();
        this.bindEvents();
    }

    createDialog() {
        this.dialogElement = document.createElement('div');
        this.dialogElement.className = 'permission-dialog fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 hidden';
        
        const dialogContent = document.createElement('div');
        dialogContent.className = 'bg-white rounded-lg shadow-xl p-6 max-w-md w-full';
        
        // Header
        const header = document.createElement('div');
        header.className = 'flex justify-between items-center mb-4';
        
        const title = document.createElement('h2');
        title.className = 'text-xl font-semibold';
        title.textContent = `Permissions for ${this.appData.name}`;
        
        const closeButton = document.createElement('button');
        closeButton.className = 'text-gray-400 hover:text-gray-600';
        closeButton.innerHTML = '<i class="fas fa-times"></i>';
        closeButton.addEventListener('click', () => this.close());
        
        header.appendChild(title);
        header.appendChild(closeButton);
        
        // Permission list
        const permissionList = document.createElement('div');
        permissionList.className = 'space-y-4';
        
        this.permissions.forEach(permission => {
            const permissionElement = this.createPermissionElement(permission);
            permissionList.appendChild(permissionElement);
            this.permissionElements.set(permission.id, permissionElement);
        });
        
        // Action buttons
        const buttonContainer = document.createElement('div');
        buttonContainer.className = 'flex justify-end space-x-4 mt-6';
        
        const cancelButton = document.createElement('button');
        cancelButton.className = 'px-4 py-2 text-gray-600 hover:text-gray-800';
        cancelButton.textContent = 'Cancel';
        cancelButton.addEventListener('click', () => this.close());
        
        const allowButton = document.createElement('button');
        allowButton.className = 'px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600';
        allowButton.textContent = 'Allow';
        allowButton.addEventListener('click', () => this.handleAllow());
        
        buttonContainer.appendChild(cancelButton);
        buttonContainer.appendChild(allowButton);
        
        dialogContent.appendChild(header);
        dialogContent.appendChild(permissionList);
        dialogContent.appendChild(buttonContainer);
        
        this.dialogElement.appendChild(dialogContent);
        document.body.appendChild(this.dialogElement);
    }

    createPermissionElement(permission) {
        const container = document.createElement('div');
        container.className = 'flex items-center justify-between p-3 bg-gray-50 rounded';
        
        const content = document.createElement('div');
        content.className = 'flex-1';
        
        const icon = document.createElement('i');
        icon.className = `fas fa-${permission.icon} text-${permission.color} mr-3`;
        
        const description = document.createElement('div');
        description.className = 'flex-1';
        
        const title = document.createElement('h3');
        title.className = 'text-sm font-medium';
        title.textContent = permission.title;
        
        const details = document.createElement('p');
        details.className = 'text-xs text-gray-500';
        details.textContent = permission.description;
        
        description.appendChild(title);
        description.appendChild(details);
        
        content.appendChild(icon);
        content.appendChild(description);
        
        const toggle = document.createElement('div');
        toggle.className = 'relative';
        
        const switchElement = document.createElement('input');
        switchElement.type = 'checkbox';
        switchElement.className = 'sr-only peer';
        switchElement.checked = permission.default;
        
        const track = document.createElement('div');
        track.className = 'w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600';
        
        toggle.appendChild(switchElement);
        toggle.appendChild(track);
        
        container.appendChild(content);
        container.appendChild(toggle);
        
        return container;
    }

    bindEvents() {
        // Handle permission toggle changes
        this.dialogElement.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
            checkbox.addEventListener('change', (event) => {
                const permissionId = event.target.dataset.permissionId;
                const isChecked = event.target.checked;
                this.handlePermissionChange(permissionId, isChecked);
            });
        });
    }

    handlePermissionChange(permissionId, isChecked) {
        // Update permission state
        const permission = this.permissions.find(p => p.id === permissionId);
        if (permission) {
            permission.enabled = isChecked;
        }

        // Emit permission change event
        this.dialogElement.dispatchEvent(new CustomEvent('permission-change', {
            detail: {
                permissionId,
                enabled: isChecked
            }
        }));
    }

    handleAllow() {
        // Emit allow event with all permissions
        this.dialogElement.dispatchEvent(new CustomEvent('allow', {
            detail: {
                appId: this.appData.id,
                permissions: Array.from(this.permissionElements.entries()).map(([id, el]) => ({
                    id,
                    enabled: el.querySelector('input[type="checkbox"]').checked
                }))
            }
        }));
        this.close();
    }

    show() {
        this.dialogElement.classList.remove('hidden');
    }

    close() {
        this.dialogElement.classList.add('hidden');
    }

    static create(appData, permissions) {
        return new PermissionDialog(appData, permissions);
    }
}
