const os = require('os');
const fs = require('fs').promises;
const path = require('path');
const { execAsync } = require('util').promisify(require('child_process').exec);
const { ProtocolHandler } = require('../server');

class SystemProtocol extends ProtocolHandler {
    constructor(config = {}) {
        super(config);
        
        this.name = 'system';
        this.version = '1.0.0';
        this.description = 'System information and notifications';
        
        this.config = {
            allowSystemCommands: false,
            allowNotifications: true,
            allowClipboard: true,
            allowSystemInfo: true,
            maxNotificationLength: 500,
            notificationTimeout: 5000,
            ...config
        };
        
        // Notification tracking
        this.activeNotifications = new Map();
        this.notificationCounter = 0;
    }
    
    // Get basic system information
    async getSystemInfo(params, context) {
        try {
            if (!this.config.allowSystemInfo) {
                throw new Error('System information access is disabled');
            }
            
            const { detailed = false } = params;
            
            const basicInfo = {
                platform: os.platform(),
                arch: os.arch(),
                hostname: os.hostname(),
                type: os.type(),
                release: os.release(),
                uptime: os.uptime(),
                nodeVersion: process.version,
                timestamp: new Date().toISOString()
            };
            
            if (detailed) {
                const detailedInfo = {
                    ...basicInfo,
                    memory: {
                        total: os.totalmem(),
                        free: os.freemem(),
                        used: os.totalmem() - os.freemem(),
                        processUsage: process.memoryUsage()
                    },
                    cpu: {
                        model: os.cpus()[0]?.model || 'Unknown',
                        count: os.cpus().length,
                        speed: os.cpus()[0]?.speed || 0,
                        loadAverage: os.loadavg(),
                        usage: await this.getCpuUsage()
                    },
                    network: await this.getNetworkInterfaces(),
                    storage: await this.getStorageInfo(),
                    environment: {
                        user: os.userInfo().username,
                        shell: process.env.SHELL || process.env.ComSpec,
                        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
                    }
                };
                
                return detailedInfo;
            }
            
            return basicInfo;
            
        } catch (error) {
            throw new Error(`Get system info failed: ${error.message}`);
        }
    }
    
    // Show desktop notification
    async showNotification(params, context) {
        try {
            if (!this.config.allowNotifications) {
                throw new Error('Notifications are disabled');
            }
            
            const { 
                title, 
                body, 
                icon, 
                timeout = this.config.notificationTimeout,
                urgent = false,
                actions = []
            } = params;
            const { appId } = context;
            
            // Validate notification content
            if (!title || title.length === 0) {
                throw new Error('Notification title is required');
            }
            
            if (body && body.length > this.config.maxNotificationLength) {
                throw new Error(`Notification body too long: ${body.length} > ${this.config.maxNotificationLength}`);
            }
            
            const notificationId = `${appId}-${++this.notificationCounter}`;
            
            const notification = {
                id: notificationId,
                appId,
                title: title.substring(0, 100), // Limit title length
                body: body ? body.substring(0, this.config.maxNotificationLength) : '',
                icon,
                timeout,
                urgent,
                actions,
                createdAt: new Date(),
                shown: false
            };
            
            // Show platform-specific notification
            const result = await this.showPlatformNotification(notification);
            
            // Track notification
            this.activeNotifications.set(notificationId, {
                ...notification,
                shown: true,
                platformResult: result
            });
            
            // Auto-remove after timeout
            if (timeout > 0) {
                setTimeout(() => {
                    this.activeNotifications.delete(notificationId);
                }, timeout);
            }
            
            return {
                notificationId,
                success: true,
                platform: os.platform(),
                ...result
            };
            
        } catch (error) {
            throw new Error(`Show notification failed: ${error.message}`);
        }
    }
    
    // Get system performance metrics
    async getPerformanceMetrics(params, context) {
        try {
            const { duration = 1000 } = params; // Sample duration in ms
            
            const startUsage = process.cpuUsage();
            const startTime = process.hrtime.bigint();
            
            // Wait for sample duration
            await new Promise(resolve => setTimeout(resolve, duration));
            
            const endUsage = process.cpuUsage(startUsage);
            const endTime = process.hrtime.bigint();
            const timeDiff = Number(endTime - startTime) / 1000000; // Convert to ms
            
            // Calculate CPU usage percentages
            const userCpuPercent = (endUsage.user / 1000) / timeDiff * 100;
            const systemCpuPercent = (endUsage.system / 1000) / timeDiff * 100;
            
            const metrics = {
                timestamp: new Date().toISOString(),
                cpu: {
                    user: userCpuPercent,
                    system: systemCpuPercent,
                    total: userCpuPercent + systemCpuPercent,
                    loadAverage: os.loadavg()
                },
                memory: {
                    ...process.memoryUsage(),
                    systemTotal: os.totalmem(),
                    systemFree: os.freemem(),
                    systemUsed: os.totalmem() - os.freemem()
                },
                process: {
                    pid: process.pid,
                    uptime: process.uptime(),
                    version: process.version,
                    platform: process.platform,
                    arch: process.arch
                }
            };
            
            return metrics;
            
        } catch (error) {
            throw new Error(`Get performance metrics failed: ${error.message}`);
        }
    }
    
    // Get environment variables (filtered for security)
    async getEnvironment(params, context) {
        try {
            const { filter = [] } = params;
            
            // Safe environment variables that can be exposed
            const safeEnvVars = [
                'NODE_ENV',
                'PWA_MARKETPLACE_VERSION',
                'LANG',
                'LANGUAGE',
                'TZ',
                'PATH',
                'HOME',
                'USER',
                'USERPROFILE',
                'TEMP',
                'TMP'
            ];
            
            const env = {};
            
            // Include requested safe variables
            for (const key of safeEnvVars) {
                if (process.env[key] && (filter.length === 0 || filter.includes(key))) {
                    env[key] = process.env[key];
                }
            }
            
            return {
                environment: env,
                platform: os.platform(),
                availableVars: safeEnvVars
            };
            
        } catch (error) {
            throw new Error(`Get environment failed: ${error.message}`);
        }
    }
    
    // Read from clipboard
    async readClipboard(params, context) {
        try {
            if (!this.config.allowClipboard) {
                throw new Error('Clipboard access is disabled');
            }
            
            const { format = 'text' } = params;
            
            // Platform-specific clipboard reading
            let content = '';
            
            switch (os.platform()) {
                case 'win32':
                    content = await this.readClipboardWindows(format);
                    break;
                case 'darwin':
                    content = await this.readClipboardMacOS(format);
                    break;
                case 'linux':
                    content = await this.readClipboardLinux(format);
                    break;
                default:
                    throw new Error(`Clipboard not supported on platform: ${os.platform()}`);
            }
            
            return {
                content,
                format,
                length: content.length,
                timestamp: new Date().toISOString()
            };
            
        } catch (error) {
            throw new Error(`Read clipboard failed: ${error.message}`);
        }
    }
    
    // Write to clipboard
    async writeClipboard(params, context) {
        try {
            if (!this.config.allowClipboard) {
                throw new Error('Clipboard access is disabled');
            }
            
            const { content, format = 'text' } = params;
            
            if (typeof content !== 'string') {
                throw new Error('Clipboard content must be a string');
            }
            
            // Platform-specific clipboard writing
            let success = false;
            
            switch (os.platform()) {
                case 'win32':
                    success = await this.writeClipboardWindows(content, format);
                    break;
                case 'darwin':
                    success = await this.writeClipboardMacOS(content, format);
                    break;
                case 'linux':
                    success = await this.writeClipboardLinux(content, format);
                    break;
                default:
                    throw new Error(`Clipboard not supported on platform: ${os.platform()}`);
            }
            
            return {
                success,
                format,
                length: content.length,
                timestamp: new Date().toISOString()
            };
            
        } catch (error) {
            throw new Error(`Write clipboard failed: ${error.message}`);
        }
    }
    
    // Get active notifications
    async getNotifications(params, context) {
        try {
            const { appId } = context;
            const { includeAll = false } = params;
            
            const notifications = Array.from(this.activeNotifications.values())
                .filter(notification => includeAll || notification.appId === appId)
                .map(notification => ({
                    id: notification.id,
                    appId: notification.appId,
                    title: notification.title,
                    body: notification.body,
                    createdAt: notification.createdAt,
                    shown: notification.shown
                }));
            
            return {
                notifications,
                count: notifications.length,
                total: this.activeNotifications.size
            };
            
        } catch (error) {
            throw new Error(`Get notifications failed: ${error.message}`);
        }
    }
    
    // Dismiss notification
    async dismissNotification(params, context) {
        try {
            const { notificationId } = params;
            const { appId } = context;
            
            const notification = this.activeNotifications.get(notificationId);
            
            if (!notification) {
                return {
                    success: false,
                    reason: 'Notification not found'
                };
            }
            
            // Check if app owns this notification
            if (notification.appId !== appId) {
                throw new Error('Cannot dismiss notification from another app');
            }
            
            // Remove notification
            this.activeNotifications.delete(notificationId);
            
            return {
                success: true,
                notificationId
            };
            
        } catch (error) {
            throw new Error(`Dismiss notification failed: ${error.message}`);
        }
    }
    
    // Get system capabilities
    async getCapabilities(params, context) {
        try {
            const capabilities = {
                platform: os.platform(),
                arch: os.arch(),
                features: {
                    notifications: this.config.allowNotifications,
                    clipboard: this.config.allowClipboard,
                    systemInfo: this.config.allowSystemInfo,
                    systemCommands: this.config.allowSystemCommands
                },
                limits: {
                    maxNotificationLength: this.config.maxNotificationLength,
                    notificationTimeout: this.config.notificationTimeout
                },
                supported: {
                    fileSystem: true,
                    network: true,
                    storage: true,
                    permissions: true
                }
            };
            
            return capabilities;
            
        } catch (error) {
            throw new Error(`Get capabilities failed: ${error.message}`);
        }
    }
    
    // Private helper methods
    
    async getCpuUsage() {
        // Simple CPU usage calculation
        const cpus = os.cpus();
        let totalIdle = 0;
        let totalTick = 0;
        
        for (const cpu of cpus) {
            for (const type in cpu.times) {
                totalTick += cpu.times[type];
            }
            totalIdle += cpu.times.idle;
        }
        
        const idle = totalIdle / cpus.length;
        const total = totalTick / cpus.length;
        const usage = 100 - ~~(100 * idle / total);
        
        return {
            usage,
            cores: cpus.length,
            details: cpus.map(cpu => ({
                model: cpu.model,
                speed: cpu.speed
            }))
        };
    }
    
    async getNetworkInterfaces() {
        const interfaces = os.networkInterfaces();
        const result = {};
        
        for (const [name, addresses] of Object.entries(interfaces)) {
            result[name] = addresses.map(addr => ({
                address: addr.address,
                family: addr.family,
                internal: addr.internal
            }));
        }
        
        return result;
    }
    
    async getStorageInfo() {
        // Basic storage info - in a real implementation you'd use platform-specific tools
        try {
            const stats = await fs.stat(process.cwd());
            return {
                current: {
                    path: process.cwd(),
                    available: 'N/A', // Would need platform-specific implementation
                    total: 'N/A'
                }
            };
        } catch {
            return { error: 'Storage info not available' };
        }
    }
    
    async showPlatformNotification(notification) {
        try {
            switch (os.platform()) {
                case 'win32':
                    return await this.showWindowsNotification(notification);
                case 'darwin':
                    return await this.showMacOSNotification(notification);
                case 'linux':
                    return await this.showLinuxNotification(notification);
                default:
                    throw new Error(`Notifications not supported on ${os.platform()}`);
            }
        } catch (error) {
            return { success: false, error: error.message };
        }
    }
    
    async showWindowsNotification(notification) {
        // Windows toast notification via PowerShell
        const script = `
            Add-Type -AssemblyName System.Windows.Forms
            $notification = New-Object System.Windows.Forms.NotifyIcon
            $notification.Icon = [System.Drawing.SystemIcons]::Information
            $notification.BalloonTipTitle = "${notification.title}"
            $notification.BalloonTipText = "${notification.body}"
            $notification.Visible = $true
            $notification.ShowBalloonTip(${notification.timeout})
        `;
        
        try {
            await execAsync(`powershell -Command "${script}"`);
            return { success: true, method: 'powershell' };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }
    
    async showMacOSNotification(notification) {
        // macOS notification via osascript
        const script = `display notification "${notification.body}" with title "${notification.title}"`;
        
        try {
            await execAsync(`osascript -e '${script}'`);
            return { success: true, method: 'osascript' };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }
    
    async showLinuxNotification(notification) {
        // Linux notification via notify-send
        try {
            await execAsync(`notify-send "${notification.title}" "${notification.body}"`);
            return { success: true, method: 'notify-send' };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }
    
    async readClipboardWindows(format) {
        const { stdout } = await execAsync('powershell -Command "Get-Clipboard"');
        return stdout.trim();
    }
    
    async readClipboardMacOS(format) {
        const { stdout } = await execAsync('pbpaste');
        return stdout;
    }
    
    async readClipboardLinux(format) {
        try {
            const { stdout } = await execAsync('xclip -selection clipboard -o');
            return stdout;
        } catch {
            // Fallback to xsel
            const { stdout } = await execAsync('xsel --clipboard --output');
            return stdout;
        }
    }
    
    async writeClipboardWindows(content, format) {
        await execAsync(`powershell -Command "Set-Clipboard -Value '${content}'"`);
        return true;
    }
    
    async writeClipboardMacOS(content, format) {
        await execAsync(`echo "${content}" | pbcopy`);
        return true;
    }
    
    async writeClipboardLinux(content, format) {
        try {
            await execAsync(`echo "${content}" | xclip -selection clipboard`);
            return true;
        } catch {
            // Fallback to xsel
            await execAsync(`echo "${content}" | xsel --clipboard --input`);
            return true;
        }
    }
}

module.exports = SystemProtocol;