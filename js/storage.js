export class StorageManager {
    static async initializeDefaultCategories() {
        const data = await chrome.storage.local.get('categories');
        if (!data.categories) {
            const defaultCategories = {
                'Work': [],
                'Leisure': [],
                'Others': [],
            };
            await chrome.storage.local.set({ categories: defaultCategories });
        }
    }


    // Add a new category
    static async addCategory(categoryName) {
        const data = await chrome.storage.local.get('categories');
        const categories = data.categories || {};

        if (!categories[categoryName]) {
            categories[categoryName] = [];
            await chrome.storage.local.set({ categories });
        }

        return categories;
    }


    static async getCategoryForDomain(domain) {
        const data = await chrome.storage.local.get('categories');
        const categories = data.categories || {};

        // Look through all categories to find the domain
        for (const [category, domains] of Object.entries(categories)) {
            if (domains && domains.includes(domain)) {
                return category;
            }
        }

        return 'other'; // Default category if none found
    }

    // Remove an existing category and move its domains to 'other'
    static async removeCategory(categoryName) {
        const data = await chrome.storage.local.get('categories');
        const categories = data.categories || {};

        if (categories[categoryName]) {
            // Ensure 'other' category exists
            if (!categories['other']) {
                categories['other'] = [];
            }

            // Move domains to 'other' category
            categories['other'] = [...categories['other'], ...categories[categoryName]];

            // Delete the category
            delete categories[categoryName];

            await chrome.storage.local.set({ categories });
        }

        return categories;
    }



    // Add a website to a category
    static async addWebsiteToCategory(domain, categoryName) {
        const data = await chrome.storage.local.get('categories');
        const categories = data.categories || {};

        // Create the category if it doesn't exist
        if (!categories[categoryName]) {
            categories[categoryName] = [];
        }

        // Remove domain from all categories
        Object.keys(categories).forEach(category => {
            categories[category] = categories[category].filter(d => d !== domain);
        });

        // Add domain to the specified category
        categories[categoryName].push(domain);

        await chrome.storage.local.set({ categories });
        return categories;
    }

    // Set a time limit for a domain (in minutes)
    static async setTimeLimit(domain, timeLimitMinutes) {
        const data = await chrome.storage.local.get('timeLimits');
        const timeLimits = data.timeLimits || {};
        // Store the time limit in minutes
        timeLimits[domain] = timeLimitMinutes;
        await chrome.storage.local.set({ timeLimits });
    }
    
    

    // Remove the time limit for a domain
    static async removeTimeLimit(domain) {
        const data = await chrome.storage.local.get('timeLimits');
        const timeLimits = data.timeLimits || {};

        delete timeLimits[domain];
        await chrome.storage.local.set({ timeLimits });
        return timeLimits;
    }

    // Get the time limit for a domain (in milliseconds)
    static async getTimeLimit(domain) {
        const data = await chrome.storage.local.get('timeLimits');
        const timeLimits = data.timeLimits || {};
        // Return the time limit in minutes
        return timeLimits[domain] || null;
    }
    
    

    // Save a time entry (visit data)
    static async saveTimeEntry(visitData) {
        const data = await chrome.storage.local.get(['dailyData']);
        const dailyData = data.dailyData || {};
        
        if (!dailyData[visitData.date]) {
            dailyData[visitData.date] = {
                categories: {},
                domains: {},
                totalTime: 0
            };
        }
    
        const daily = dailyData[visitData.date];
        
        // Add new duration to existing values
        daily.totalTime += visitData.duration;
        daily.categories[visitData.category] = (daily.categories[visitData.category] || 0) + visitData.duration;
        daily.domains[visitData.domain] = visitData.newTotal;  // Use accumulated time
    
        await chrome.storage.local.set({ dailyData });
        return dailyData;
    }
    
    
    

    // Calculate productivity score based on category times
    static calculateProductivityScore(categoriesData) {
        const productiveCategories = ['work', 'education', 'development'];
        const unproductiveCategories = ['social', 'entertainment'];

        let productiveTime = 0;
        let totalTime = 0;

        Object.entries(categoriesData || {}).forEach(([category, time]) => {
            totalTime += time;
            if (productiveCategories.includes(category.toLowerCase())) {
                productiveTime += time;
            }
        });

        return totalTime === 0 ? 0 : (productiveTime / totalTime) * 100;
    }

    // Reset today's stats
    static async resetDailyStats() {
        const today = new Date().toISOString().split('T')[0];
        const data = await chrome.storage.local.get('dailyData');
        const dailyData = data.dailyData || {};

        dailyData[today] = {
            categories: {},
            domains: {},
            totalTime: 0
        };

        await chrome.storage.local.set({ dailyData });
        return dailyData;
    }

    // Get daily stats for a specific date
    static async getDailyStats(date) {
        const data = await chrome.storage.local.get(['timeData', 'dailyData']);
        return {
            timeData: data.timeData || {},
            dailyData: data.dailyData?.[date] || null
        };
    }

    // Get stats for the last 7 days
    static async getWeeklyStats() {
        const data = await chrome.storage.local.get('dailyData');
        const dailyData = data.dailyData || {};

        const last7Days = [...Array(7)].map((_, i) => {
            const d = new Date();
            d.setDate(d.getDate() - i);
            return d.toISOString().split('T')[0];
        });

        return last7Days.map(date => ({
            date,
            stats: dailyData[date] || null
        }));
    }

    // Export all stored data as a JSON string
    static async exportData() {
        const data = await chrome.storage.local.get(null);
        return JSON.stringify(data, null, 2);
    }

    // Import data from a JSON string
    static async importData(jsonData) {
        try {
            const data = JSON.parse(jsonData);
            await chrome.storage.local.clear();
            await chrome.storage.local.set(data);
            return true;
        } catch (error) {
            console.error('Error importing data:', error);
            return false;
        }
    }

    // Cleanup data older than a specified number of days (default: 30 days)
    static async cleanup(daysToKeep = 30) {
        const data = await chrome.storage.local.get(['timeData', 'dailyData']);
        const timeData = data.timeData || {};
        const dailyData = data.dailyData || {};

        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
        const cutoffString = cutoffDate.toISOString().split('T')[0];

        // Cleanup old dailyData entries
        Object.keys(dailyData).forEach(date => {
            if (date < cutoffString) {
                delete dailyData[date];
            }
        });

        // Cleanup old timeData entries
        Object.keys(timeData).forEach(domain => {
            timeData[domain] = timeData[domain].filter(entry => entry.date >= cutoffString);
            if (timeData[domain].length === 0) {
                delete timeData[domain];
            }
        });

        await chrome.storage.local.set({ timeData, dailyData });
        return { timeData, dailyData };
    }
}
