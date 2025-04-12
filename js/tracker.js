import { StorageManager } from './storage.js';


export function formatTime(ms) {
    const seconds = Math.floor(ms / 1000);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;

    const padZero = (num) => num.toString().padStart(2, '0');

    return `${padZero(hours)}:${padZero(minutes)}:${padZero(remainingSeconds)}`;
}
export { formatTime };

export class TimeTracker {
    constructor() {
        this.activeTimers = new Map();
        this.categories = {
            "social": ["facebook.com", "twitter.com", "instagram.com"],
            "work": ["github.com", "gitlab.com", "docs.google.com"],
            "entertainment": ["youtube.com", "netflix.com", "spotify.com"],
        };
        this.initialized = this.initialize();
    }

    async initialize(){
        await StorageManager.initializeDefaultCategories();
        await this.loadCategories();
    }

    async loadCategories() {
        const data = await chrome.storage.local.get('categories');
        this.categories = data.categories || this.categories;
    }

    getCategory(domain) {
        for(let [category, domains] of Object.entries(this.categories)){
            if (domains.some(d => domain.includes(d))) {
                return category;
            }
        }
        return 'other';
    }


    async startTimer(domain){
        const timeLimit = await StorageManager.getTimeLimit(domain);
        // Convert minutes to milliseconds only when timeLimit exists
        const timeLimitMs = timeLimit ? timeLimit * 60 * 1000 : null;

        console.log('Starting timer for domain:', domain);
        console.log('Time limit (minutes):', timeLimit);
        console.log('Time limit (ms):', timeLimitMs);

        const timer = {
            startTime: Date.now(),
            timeLimit: timeLimitMs,
            notifiedOvertime: false
        };

        this.activeTimers.set(domain, timer);
        
        if (timeLimitMs) {
            this.startTimeLimitCheck(domain);
        }
    }    

    async stopTimer(domain){
        const timer = this.activeTimers.get(domain);
        if(timer){
            const endTime = Date.now();
            this.activeTimers.delete(domain);
            await this.processVisit(domain, timer.startTime, endTime);
        }
    }

    startTimeLimitCheck(domain) {      
        const timer = this.activeTimers.get(domain);
        if(!timer) return;
        console.log(`Starting time limit check for ${domain}`);

        const checkInterval = setInterval(() => {
            const currentTimer = this.activeTimers.get(domain);

            if (!currentTimer) {
                clearInterval(checkInterval);
                return;
            }

            const elapsedTime = Date.now() - currentTimer.startTime;
            if (elapsedTime >= currentTimer.timeLimit && !currentTimer.notifiedOvertime) {
                this.notifyTimeLimitExceeded(domain);
                currentTimer.notifiedOvertime = true;
            }
        }, 1000);
        console.log(`Cleared time limit check for ${domain}`);
    }

    notifyTimeLimitExceeded(domain) {
        chrome.notifications.create({
            type: 'basic',
            iconUrl: '/images/icon128.png',  // Ensure the icon path is correct
            title: 'Time Limit Exceeded',
            message: `You've exceeded your time limit for ${domain}`
        });
        console.log(`notifyTimeLimitExceeded created for ${domain}`)
    }

    async processVisit(domain, startTime, endTime){
        await this.initialized;
        const category = this.getCategory(domain);
        const duration = endTime - startTime;
        
        
        const visitData = {
            domain,
            category,
            startTime,
            endTime,
            duration,
            formattedDuration: formatTime(duration),
            date: new Date(startTime).toISOString().split('T')[0]};
        
        await StorageManager.saveTimeEntry(visitData);return visitData;
    }

    calculateProductivityScore(timeData) {
        const categoryWeights = {
            "work": 1,
            "social": -0.5,
            'entertainment': -0.3,
            'other': 0
        };

        let totalTime = 0;
        let weightedTime = 0;

        Object.entries(timeData).forEach(([category, time]) =>{
            totalTime += time;
            weightedTime += time * (categoryWeights[category] || 0);
        });

        return totalTime ? Math.max(0, Math.min(100, (weightedTime / totalTime + 1) * 50)) : 50;
    }
}
