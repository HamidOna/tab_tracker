document.addEventListener('DOMContentLoaded', async () => {
    await loadDashboard();
});

async function loadDashboard() {
    try {
        const data = await chrome.storage.local.get(['dailyData']);
        const today = new Date().toISOString().split('T')[0];
        const todayData = data.dailyData?.[today] || { categories: {}, domains: {}, totalTime: 0 };

        updateProductivityScore(todayData.categories);
        updateTotalTime(todayData.totalTime);
        updateTopSites(todayData.domains);
        updateCategoryBreakdown(todayData.categories);
        await updateDailyActivityChart(data.dailyData);
        updateCategoryChart(todayData.categories);
    } catch (error) {
        console.error('Error loading dashboard:', error);
    }
}

function updateProductivityScore(categories) {
    const score = calculateProductivityScore(categories);
    const scoreElement = document.getElementById('productivityScore');
    if (scoreElement) {
        scoreElement.textContent = `${Math.round(score)}%`;
        scoreElement.style.color = getScoreColor(score);
    }
}

function calculateProductivityScore(categories) {
    const weights = {
        'work': 1,
        'social': -0.5,
        'entertainment': -0.3,
        'other': 0
    };

    let totalTime = 0;
    let weightedTime = 0;

    Object.entries(categories || {}).forEach(([category, time]) => {
        totalTime += time;
        weightedTime += time * (weights[category.toLowerCase()] || 0);
    });

    return totalTime ? Math.max(0, Math.min(100, ((weightedTime / totalTime) + 1) * 50)) : 50;
}

function updateTotalTime(totalMs) {
    const totalTimeElement = document.getElementById('totalTime');
    if (totalTimeElement) {
        totalTimeElement.textContent = formatTime(totalMs);
    }
}

function updateTopSites(domains) {
    const topSitesElement = document.getElementById('topSites');
    if (topSitesElement) {
        const sortedDomains = Object.entries(domains || {})
            .sort(([, a], [, b]) => b - a)
            .slice(0, 5);

        topSitesElement.innerHTML = sortedDomains
            .map(([domain, time]) => `
                <div class="category-item">
                    <span>${domain}</span>
                    <span>${formatTime(time)}</span>
                </div>
            `).join('');
    }
}

function updateCategoryBreakdown(categories) {
    const categoryList = document.getElementById('categoryList');
    if (categoryList) {
        const totalTime = Object.values(categories || {}).reduce((a, b) => a + b, 0);

        const categoriesHTML = Object.entries(categories || {})
            .sort(([, a], [, b]) => b - a)
            .map(([category, time]) => {
                const percentage = totalTime ? ((time / totalTime) * 100).toFixed(1) : 0;
                return `
                    <li class="category-item">
                        <div>
                            <strong>${category}</strong>
                            <div class="progress-bar">
                                <div class="progress-fill" style="width: ${percentage}%"></div>
                            </div>
                        </div>
                        <span>${formatTime(time)}</span>
                    </li>
                `;
            }).join('');

        categoryList.innerHTML = categoriesHTML;
    }
}

function formatTime(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    return `${padZero(hours)}h ${padZero(minutes)}m`;
}

function padZero(num) {
    return num.toString().padStart(2, '0');
}

function getScoreColor(score) {
    if (score >= 80) return '#27ae60';   // Green
    if (score >= 60) return '#2ecc71';   // Light Green
    if (score >= 40) return '#f1c40f';   // Yellow
    if (score >= 20) return '#e67e22';   // Orange
    return '#e74c3c';                    // Red
}

function getChartColors(count) {
    const colors = [
        '#3498db', '#2ecc71', '#e74c3c', '#f1c40f',
        '#9b59b6', '#1abc9c', '#e67e22', '#34495e'
    ];
    while (colors.length < count) {
        colors.push(...colors);
    }
    return colors.slice(0, count);
}

async function updateDailyActivityChart(dailyData) {
    const dates = getLast7Days();
    const labels = dates.map(date => formatDate(date));
    const dataPoints = dates.map(date => dailyData?.[date]?.totalTime || 0);

    const ctx = document.getElementById('dailyActivityChart')?.getContext('2d');
    if (ctx) {
        new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Total Time Spent',
                    data: dataPoints,
                    backgroundColor: 'rgba(52, 152, 219, 0.2)',
                    borderColor: 'rgba(52, 152, 219, 1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            callback: function (value) {
                                return formatTime(value);
                            }
                        }
                    }
                },
                plugins: {
                    tooltip: {
                        callbacks: {
                            label: function (context) {
                                return formatTime(context.parsed.y);
                            }
                        }
                    }
                }
            }
        });
    } else {
        console.error('Canvas element for daily activity chart not found');
    }
}

function updateCategoryChart(categories) {
    const ctx = document.getElementById('categoryChart')?.getContext('2d');
    if (ctx) {
        const categoryNames = Object.keys(categories || {});
        const categoryTimes = Object.values(categories || {});

        const colors = getChartColors(categoryNames.length);

        new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: categoryNames,
                datasets: [{
                    data: categoryTimes,
                    backgroundColor: colors,
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    tooltip: {
                        callbacks: {
                            label: function (context) {
                                const label = context.label || '';
                                const value = context.parsed || 0;
                                return `${label}: ${formatTime(value)}`;
                            }
                        }
                    }
                }
            }
        });
    } else {
        console.error('Canvas element for category chart not found');
    }
}

function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric'
    });
}

function getLast7Days() {
    const dates = [];
    const today = new Date();
    for (let i = 6; i >= 0; i--) {
        const date = new Date(today);
        date.setDate(today.getDate() - i);
        dates.push(date.toISOString().split('T')[0]);
    }
    return dates;
}
