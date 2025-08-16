class BinanceAutoTrader {
    constructor() {
        this.isRunning = false;
        this.currentAmount = 0;
        this.ui = null;
        this.logContainer = null;
        this.statusDisplay = null;
        this.currentState = 'idle'; // idle, buying, monitoring_buy, selling, monitoring_sell
        this.orderCheckInterval = null;
        this.dragOffset = { x: 0, y: 0 };
        
        this.init();
    }

    init() {
        this.createUI();
        this.setupMessageListener();
        this.log('插件已加载', 'info');
    }

    createUI() {
        this.ui = document.createElement('div');
        this.ui.id = 'binance-auto-trader';
        this.ui.innerHTML = `
            <div class="header">
                <div class="title">币安Alpha自动交易</div>
                <button class="minimize-btn" id="minimize-btn">—</button>
            </div>
            <div class="content">
                <div class="input-row">
                    <label for="trade-amount">交易金额 (USDT):</label>
                    <input type="number" id="trade-amount" placeholder="输入金额" step="0.1" min="0.1">
                </div>
                <div class="status-display" id="status-display">等待开始</div>
                <div class="control-buttons">
                    <button class="control-btn start-btn" id="start-btn">开始交易</button>
                    <button class="control-btn stop-btn" id="stop-btn" style="display: none;">停止交易</button>
                </div>
                <div class="debug-buttons" style="margin-top: 8px;">
                    <button class="control-btn debug-btn" id="switch-buy-btn">切换到买入</button>
                    <button class="control-btn debug-btn" id="switch-sell-btn">切换到卖出</button>
                    <button class="control-btn debug-btn" id="clear-log-btn">清空日志</button>
                </div>
                <div class="log-container" id="log-container"></div>
            </div>
        `;

        document.body.appendChild(this.ui);
        this.logContainer = document.getElementById('log-container');
        this.statusDisplay = document.getElementById('status-display');

        this.setupUIEvents();
        this.makeDraggable();
    }

    setupUIEvents() {
        const startBtn = document.getElementById('start-btn');
        const stopBtn = document.getElementById('stop-btn');
        const minimizeBtn = document.getElementById('minimize-btn');
        const switchBuyBtn = document.getElementById('switch-buy-btn');
        const switchSellBtn = document.getElementById('switch-sell-btn');
        const clearLogBtn = document.getElementById('clear-log-btn');

        startBtn.addEventListener('click', () => this.startTrading());
        stopBtn.addEventListener('click', () => this.stopTrading());
        minimizeBtn.addEventListener('click', () => this.toggleMinimize());
        switchBuyBtn.addEventListener('click', () => this.debugSwitchToBuy());
        switchSellBtn.addEventListener('click', () => this.debugSwitchToSell());
        clearLogBtn.addEventListener('click', () => this.clearLogs());
    }

    makeDraggable() {
        const header = this.ui.querySelector('.header');
        let isDragging = false;

        header.addEventListener('mousedown', (e) => {
            isDragging = true;
            this.ui.classList.add('dragging');
            const rect = this.ui.getBoundingClientRect();
            this.dragOffset.x = e.clientX - rect.left;
            this.dragOffset.y = e.clientY - rect.top;
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            
            const x = e.clientX - this.dragOffset.x;
            const y = e.clientY - this.dragOffset.y;
            
            this.ui.style.left = Math.max(0, Math.min(window.innerWidth - this.ui.offsetWidth, x)) + 'px';
            this.ui.style.top = Math.max(0, Math.min(window.innerHeight - this.ui.offsetHeight, y)) + 'px';
        });

        document.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                this.ui.classList.remove('dragging');
            }
        });
    }

    toggleMinimize() {
        this.ui.classList.toggle('minimized');
    }

    setupMessageListener() {
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            if (message.action === 'start') {
                this.currentAmount = message.amount;
                document.getElementById('trade-amount').value = message.amount;
                this.startTrading();
            } else if (message.action === 'stop') {
                this.stopTrading();
            }
        });
    }

    async startTrading() {
        if (this.isRunning) return;

        const amount = parseFloat(document.getElementById('trade-amount').value);
        if (!amount || amount < 0.1) {
            this.log('请输入有效金额（≥0.1 USDT）', 'error');
            return;
        }

        // 安全检查
        if (!this.performSafetyChecks()) {
            return;
        }

        this.isRunning = true;
        this.currentAmount = amount;
        this.updateUI();
        this.log(`开始自动交易，金额: ${amount} USDT`, 'info');
        
        try {
            await this.runTradingLoop();
        } catch (error) {
            this.log(`交易过程出错: ${error.message}`, 'error');
            this.stopTrading();
        }
    }

    performSafetyChecks() {
        // 检查页面URL
        if (!window.location.href.includes('binance.com/zh-CN/alpha/')) {
            this.log('错误：不在币安Alpha交易页面', 'error');
            return false;
        }

        // 检查用户是否已登录
        const loginElements = document.querySelectorAll('[class*="login"], [class*="登录"]');
        if (loginElements.length > 0) {
            this.log('警告：请先登录币安账户', 'error');
            return false;
        }

        // 检查是否能找到交易界面
        const tradingInterface = document.querySelector('.bn-tabs__buySell') || 
                                document.querySelector('[role="tablist"]');
        if (!tradingInterface) {
            this.log('错误：未找到交易界面，请刷新页面', 'error');
            return false;
        }

        // 检查网络连接
        if (!navigator.onLine) {
            this.log('错误：网络连接断开', 'error');
            return false;
        }

        this.log('安全检查通过', 'success');
        return true;
    }

    stopTrading() {
        this.isRunning = false;
        this.currentState = 'idle';
        
        if (this.orderCheckInterval) {
            clearInterval(this.orderCheckInterval);
            this.orderCheckInterval = null;
        }
        
        this.updateUI();
        this.log('交易已停止', 'info');
    }

    updateUI() {
        const startBtn = document.getElementById('start-btn');
        const stopBtn = document.getElementById('stop-btn');
        
        if (this.isRunning) {
            startBtn.style.display = 'none';
            stopBtn.style.display = 'block';
            this.statusDisplay.textContent = '交易运行中';
            this.statusDisplay.className = 'status-display running';
        } else {
            startBtn.style.display = 'block';
            stopBtn.style.display = 'none';
            this.statusDisplay.textContent = '等待开始';
            this.statusDisplay.className = 'status-display';
        }
    }

    async runTradingLoop() {
        let consecutiveErrors = 0;
        const maxConsecutiveErrors = 3;
        
        while (this.isRunning) {
            try {
                // 每次循环前检查页面状态
                if (!this.performRuntimeChecks()) {
                    await this.sleep(5000); // 等待5秒后重试
                    continue;
                }

                // 步骤1: 执行买入
                await this.executeBuyWithRetry();
                if (!this.isRunning) break;

                // 步骤2: 等待买入完成
                await this.waitForBuyComplete();
                if (!this.isRunning) break;

                // 步骤2.5: 最终确认买入已完成
                const buyConfirmed = await this.finalBuyConfirmation();
                if (!buyConfirmed) {
                    this.log('买入未成功，跳过此轮卖出', 'error');
                    await this.sleep(5000); // 等待5秒后重试
                    continue;
                }

                // 步骤3: 执行卖出
                await this.executeSellWithRetry();
                if (!this.isRunning) break;

                // 步骤4: 等待卖出完成
                await this.waitForSellComplete();
                if (!this.isRunning) break;

                consecutiveErrors = 0; // 重置错误计数
                this.log('一轮交易完成，开始下一轮', 'success');
                await this.sleep(2000); // 等待2秒后开始下一轮

            } catch (error) {
                consecutiveErrors++;
                this.log(`交易循环出错 (${consecutiveErrors}/${maxConsecutiveErrors}): ${error.message}`, 'error');
                
                if (consecutiveErrors >= maxConsecutiveErrors) {
                    this.log('连续错误次数过多，停止交易', 'error');
                    break;
                }
                
                // 等待后重试
                await this.sleep(5000);
            }
        }
    }

    performRuntimeChecks() {
        // 检查网络连接
        if (!navigator.onLine) {
            this.log('网络连接断开，等待重连...', 'error');
            return false;
        }

        // 检查页面是否还在交易页面
        if (!window.location.href.includes('binance.com/zh-CN/alpha/')) {
            this.log('页面已离开交易界面', 'error');
            return false;
        }

        return true;
    }

    async executeBuyWithRetry(maxRetries = 3) {
        for (let i = 0; i < maxRetries; i++) {
            try {
                await this.executeBuy();
                return;
            } catch (error) {
                this.log(`买入操作失败 (${i + 1}/${maxRetries}): ${error.message}`, 'error');
                if (i === maxRetries - 1) throw error;
                await this.sleep(2000);
            }
        }
    }

    async executeSellWithRetry(maxRetries = 3) {
        for (let i = 0; i < maxRetries; i++) {
            try {
                await this.executeSell();
                return;
            } catch (error) {
                this.log(`卖出操作失败 (${i + 1}/${maxRetries}): ${error.message}`, 'error');
                if (i === maxRetries - 1) throw error;
                await this.sleep(2000);
            }
        }
    }

    async executeBuy() {
        this.currentState = 'buying';
        this.log('开始执行买入操作', 'info');

        // 1. 确保在买入选项卡
        await this.switchToBuyTab();
        
        // 2. 设置成交额
        await this.setTotalAmount(this.currentAmount);
        
        // 3. 点击买入按钮
        await this.clickBuyButton();
        
        this.log('买入订单已提交', 'success');
    }

    async switchToBuyTab() {
        this.log('开始切换到买入选项卡', 'info');
        this.debugTabState();
        
        // 精确查找买入选项卡
        const buyTab = document.querySelector('#bn-tab-0') ||
                      document.querySelector('.bn-tab__buySell[aria-controls="bn-tab-pane-0"]') ||
                      document.querySelector('.bn-tab__buySell:first-child');
        
        if (!buyTab) {
            throw new Error('未找到买入选项卡');
        }
        
        // 检查是否已经是活跃状态
        if (this.isBuyTabActive()) {
            this.log('已在买入选项卡', 'info');
            return;
        }
        
        // 点击切换
        buyTab.click();
        this.log('点击买入选项卡', 'info');
        
        // 等待并验证切换结果
        const switchSuccess = await this.waitForBuyTabSwitch();
        if (!switchSuccess) {
            this.debugTabState(); // 失败时输出状态
            throw new Error('切换到买入选项卡失败，终止执行');
        }
        
        this.log('成功切换到买入选项卡', 'success');
    }

    isBuyTabActive() {
        const buyTab = document.querySelector('#bn-tab-0');
        if (!buyTab) return false;
        
        return buyTab.getAttribute('aria-selected') === 'true' && 
               buyTab.classList.contains('active');
    }

    async waitForBuyTabSwitch(maxAttempts = 10) {
        for (let i = 0; i < maxAttempts; i++) {
            await this.sleep(300);
            
            if (this.isBuyTabActive()) {
                this.log('买入选项卡切换成功', 'success');
                return true;
            }
            
            // 如果切换失败，再次尝试点击
            if (i < maxAttempts - 1) {
                this.log(`买入选项卡切换中... (${i + 1}/${maxAttempts})`, 'info');
                const buyTab = document.querySelector('#bn-tab-0');
                if (buyTab) {
                    buyTab.click();
                }
            }
        }
        
        this.log('买入选项卡切换失败', 'error');
        return false;
    }

    async setTotalAmount(amount) {
        // 查找成交额输入框
        const totalInput = document.querySelector('#limitTotal') ||
                          document.querySelector('input[placeholder*="最小"]') ||
                          document.querySelector('input[step="1e-8"]') ||
                          Array.from(document.querySelectorAll('input[type="text"]')).find(input => {
                              const container = input.closest('.w-full');
                              return container && container.querySelector('div:contains("成交额")');
                          });

        if (!totalInput) {
            throw new Error('未找到成交额输入框');
        }

        // 清空并设置新值
        totalInput.focus();
        totalInput.select();
        totalInput.value = '';
        
        // 模拟输入
        const inputEvent = new Event('input', { bubbles: true });
        const changeEvent = new Event('change', { bubbles: true });
        
        totalInput.value = amount.toString();
        totalInput.dispatchEvent(inputEvent);
        totalInput.dispatchEvent(changeEvent);
        
        await this.sleep(300);
        this.log(`设置成交额: ${amount} USDT`, 'info');
    }

    async clickBuyButton() {
        const buyButton = document.querySelector('.bn-button__buy') ||
                         document.querySelector('button[class*="buy"]') ||
                         Array.from(document.querySelectorAll('button')).find(btn => 
                             btn.textContent.includes('买入') && !btn.disabled
                         );

        if (!buyButton) {
            throw new Error('未找到买入按钮');
        }

        if (buyButton.disabled) {
            throw new Error('买入按钮不可用');
        }

        buyButton.click();
        await this.sleep(1000);
        this.log('点击买入按钮', 'success');

        // 检查并处理确认弹窗
        await this.handleConfirmationDialog();
    }

    async handleConfirmationDialog() {
        this.log('检查确认弹窗...', 'info');
        
        // 等待弹窗出现
        await this.sleep(1000);
        
        // 查找确认弹窗中的"继续"按钮
        const confirmButton = this.findConfirmButton();
        
        if (confirmButton) {
            this.log('发现确认弹窗，点击继续', 'info');
            confirmButton.click();
            await this.sleep(1000);
            this.log('确认买入订单', 'success');
        } else {
            this.log('未发现确认弹窗，继续执行', 'info');
        }
    }

    findConfirmButton() {
        // 方法1: 基于具体DOM结构查找 - 查找包含px-[24px] pb-[24px]的容器
        const confirmContainers = document.querySelectorAll('[class*="px-[24px]"][class*="pb-[24px]"]');
        for (const container of confirmContainers) {
            // 检查是否包含买入相关信息
            if (container.textContent.includes('限价') && container.textContent.includes('买入')) {
                const button = container.querySelector('button.bn-button.bn-button__primary');
                if (button && button.textContent.includes('继续')) {
                    return button;
                }
            }
        }

        // 方法2: 直接查找"继续"按钮
        let confirmButton = Array.from(document.querySelectorAll('button')).find(btn => 
            btn.textContent.trim() === '继续' && !btn.disabled
        );

        if (confirmButton) return confirmButton;

        // 方法3: 查找确认弹窗中的主要按钮
        confirmButton = document.querySelector('.bn-button__primary[class*="w-full"]') ||
                       document.querySelector('button.bn-button.bn-button__primary[class*="w-full"]');

        if (confirmButton && (confirmButton.textContent.includes('继续') || confirmButton.textContent.includes('确认'))) {
            return confirmButton;
        }

        // 方法4: 查找包含订单详情的弹窗
        const orderDetailsElements = document.querySelectorAll('[class*="类型"], [class*="数量"], [class*="成交额"]');
        for (const element of orderDetailsElements) {
            const container = element.closest('[class*="px-[24px]"]');
            if (container) {
                const button = container.querySelector('button[class*="primary"]');
                if (button && !button.disabled) {
                    return button;
                }
            }
        }

        // 方法5: 模糊匹配 - 查找任何包含确认信息的按钮
        const allButtons = document.querySelectorAll('button');
        for (const button of allButtons) {
            if ((button.textContent.includes('继续') || button.textContent.includes('确认')) && 
                !button.disabled && 
                button.offsetParent !== null) { // 确保按钮可见
                return button;
            }
        }

        return null;
    }

    async waitForBuyComplete() {
        this.currentState = 'monitoring_buy';
        this.log('等待买入订单完成...', 'info');

        return new Promise((resolve, reject) => {
            let checkCount = 0;
            const maxChecks = 120; // 最多检查2分钟
            
            this.orderCheckInterval = setInterval(async () => {
                checkCount++;
                
                if (!this.isRunning) {
                    clearInterval(this.orderCheckInterval);
                    resolve();
                    return;
                }

                if (checkCount > maxChecks) {
                    clearInterval(this.orderCheckInterval);
                    reject(new Error('买入订单等待超时'));
                    return;
                }

                try {
                    const isComplete = await this.checkBuyOrderComplete();
                    if (isComplete) {
                        clearInterval(this.orderCheckInterval);
                        this.log('买入订单完成', 'success');
                        resolve();
                    }
                } catch (error) {
                    this.log(`检查买入状态出错: ${error.message}`, 'error');
                }
            }, 1000);
        });
    }

    async checkBuyOrderComplete() {
        // 首先检查是否有买入委托记录存在
        const hasActiveBuyOrder = await this.checkActiveBuyOrder();
        
        if (!hasActiveBuyOrder) {
            // 如果没有活跃的买入委托，说明订单已经完成
            this.log('买入委托记录已消失，订单完成', 'success');
            return true;
        } else {
            // 如果还有活跃的买入委托，说明订单还在进行中
            this.log('买入委托仍在进行中...', 'info');
            return false;
        }
    }

    async checkActiveBuyOrder() {
        // 确保在当前委托选项卡
        await this.switchToCurrentOrders();
        
        // 查找当前委托表格中的买入订单
        const orderRows = this.getOrderTableRows();
        
        for (const row of orderRows) {
            const rowText = row.textContent;
            
            // 检查是否包含买入相关信息
            if (rowText.includes('买入') || rowText.includes('Buy')) {
                // 进一步检查订单状态
                const statusCell = row.querySelector('td[aria-colindex="7"]'); // 状态列
                if (statusCell) {
                    const status = statusCell.textContent.trim();
                    // 如果状态是"新订单"、"部分成交"等，说明订单还在进行
                    if (status.includes('新订单') || status.includes('部分成交') || 
                        status.includes('New') || status.includes('Partial')) {
                        this.log(`发现活跃买入订单，状态: ${status}`, 'info');
                        return true;
                    }
                }
            }
        }
        
        return false;
    }

    async switchToCurrentOrders() {
        // 切换到当前委托选项卡
        const currentOrderTab = document.querySelector('[data-tab-key="orderOrder"]') ||
                               document.querySelector('#bn-tab-orderOrder') ||
                               Array.from(document.querySelectorAll('[role="tab"]')).find(tab => 
                                   tab.textContent.includes('当前委托')
                               );
        
        if (currentOrderTab && !currentOrderTab.classList.contains('active')) {
            currentOrderTab.click();
            this.log('切换到当前委托选项卡', 'info');
            await this.sleep(500); // 等待切换完成
        }
        
        // 确保在限价选项卡
        const limitTab = document.querySelector('[data-tab-key="limit"]') ||
                        document.querySelector('#bn-tab-limit') ||
                        Array.from(document.querySelectorAll('[role="tab"]')).find(tab => 
                            tab.textContent.includes('限价')
                        );
        
        if (limitTab && !limitTab.classList.contains('active')) {
            limitTab.click();
            this.log('切换到限价委托选项卡', 'info');
            await this.sleep(500); // 等待切换完成
        }
    }

    getOrderTableRows() {
        // 查找委托表格中的数据行
        const tableBody = document.querySelector('.bn-web-table-tbody');
        if (!tableBody) {
            this.log('未找到委托表格', 'error');
            return [];
        }
        
        // 获取所有数据行，排除测量行
        const rows = Array.from(tableBody.querySelectorAll('tr')).filter(row => 
            !row.classList.contains('bn-web-table-measure-row') && 
            row.style.height !== '0px'
        );
        
        return rows;
    }

    async finalBuyConfirmation() {
        this.log('进行最终买入确认检查...', 'info');
        
        // 等待一段时间确保数据更新
        await this.sleep(2000);
        
        // 检查当前委托中是否还有买入订单
        const hasActiveBuyOrder = await this.checkActiveBuyOrder();
        if (hasActiveBuyOrder) {
            this.log('仍有活跃买入委托，买入未完成', 'error');
            return false;
        }
        
        // 检查是否有代币余额（表示买入成功）
        const hasTokenBalance = await this.checkTokenBalance();
        if (!hasTokenBalance) {
            this.log('未检测到代币余额，买入可能失败', 'error');
            return false;
        }
        
        this.log('最终确认：买入已成功完成', 'success');
        return true;
    }

    async checkTokenBalance() {
        // 切换到持有币种选项卡检查余额
        const holdingsTab = document.querySelector('[data-tab-key="holdings"]') ||
                           document.querySelector('#bn-tab-holdings') ||
                           Array.from(document.querySelectorAll('[role="tab"]')).find(tab => 
                               tab.textContent.includes('持有币种')
                           );
        
        if (holdingsTab && !holdingsTab.classList.contains('active')) {
            holdingsTab.click();
            this.log('切换到持有币种选项卡', 'info');
            await this.sleep(1000); // 等待选项卡切换完成
        }
        
        // 查找代币余额
        const balanceElements = document.querySelectorAll('td, div');
        for (const element of balanceElements) {
            const text = element.textContent;
            // 查找非USDT的代币余额
            if (text && text.match(/[\d.]+\s*(KOGE|[A-Z]{2,10})/) && !text.includes('USDT')) {
                const match = text.match(/([\d.]+)/);
                if (match && parseFloat(match[1]) > 0) {
                    this.log(`检测到代币余额: ${text}`, 'success');
                    return true;
                }
            }
        }
        
        return false;
    }

    async executeSell() {
        this.currentState = 'selling';
        this.log('开始执行卖出操作', 'info');

        // 1. 切换到卖出选项卡
        await this.switchToSellTab();
        
        // 2. 拉满数量滑杆
        await this.setMaxQuantity();
        
        // 3. 点击卖出按钮
        await this.clickSellButton();
        
        this.log('卖出订单已提交', 'success');
    }

    async switchToSellTab() {
        this.log('开始切换到卖出选项卡', 'info');
        this.debugTabState();
        
        // 精确查找卖出选项卡
        const sellTab = document.querySelector('#bn-tab-1') ||
                       document.querySelector('.bn-tab__buySell[aria-controls="bn-tab-pane-1"]') ||
                       document.querySelector('.bn-tab__buySell:nth-child(2)');
        
        if (!sellTab) {
            throw new Error('未找到卖出选项卡');
        }
        
        // 检查是否已经是活跃状态
        if (this.isSellTabActive()) {
            this.log('已在卖出选项卡', 'info');
            return;
        }
        
        // 点击切换
        sellTab.click();
        this.log('点击卖出选项卡', 'info');
        
        // 等待并验证切换结果
        const switchSuccess = await this.waitForSellTabSwitch();
        if (!switchSuccess) {
            this.debugTabState(); // 失败时输出状态
            throw new Error('切换到卖出选项卡失败，终止执行');
        }
        
        this.log('成功切换到卖出选项卡', 'success');
    }

    isSellTabActive() {
        const sellTab = document.querySelector('#bn-tab-1');
        if (!sellTab) return false;
        
        return sellTab.getAttribute('aria-selected') === 'true' && 
               sellTab.classList.contains('active');
    }

    async waitForSellTabSwitch(maxAttempts = 10) {
        for (let i = 0; i < maxAttempts; i++) {
            await this.sleep(300);
            
            if (this.isSellTabActive()) {
                this.log('卖出选项卡切换成功', 'success');
                return true;
            }
            
            // 如果切换失败，再次尝试点击
            if (i < maxAttempts - 1) {
                this.log(`卖出选项卡切换中... (${i + 1}/${maxAttempts})`, 'info');
                const sellTab = document.querySelector('#bn-tab-1');
                if (sellTab) {
                    sellTab.click();
                }
            }
        }
        
        this.log('卖出选项卡切换失败', 'error');
        return false;
    }

    debugTabState() {
        const buyTab = document.querySelector('#bn-tab-0');
        const sellTab = document.querySelector('#bn-tab-1');
        
        if (buyTab) {
            const buySelected = buyTab.getAttribute('aria-selected');
            const buyActive = buyTab.classList.contains('active');
            this.log(`买入选项卡状态: aria-selected=${buySelected}, active=${buyActive}`, 'info');
        } else {
            this.log('未找到买入选项卡元素', 'error');
        }
        
        if (sellTab) {
            const sellSelected = sellTab.getAttribute('aria-selected');
            const sellActive = sellTab.classList.contains('active');
            this.log(`卖出选项卡状态: aria-selected=${sellSelected}, active=${sellActive}`, 'info');
        } else {
            this.log('未找到卖出选项卡元素', 'error');
        }
    }

    async setMaxQuantity() {
        // 查找数量滑杆
        const slider = document.querySelector('.bn-slider') ||
                      document.querySelector('input[type="range"]') ||
                      document.querySelector('[role="slider"]');

        if (slider) {
            // 设置滑杆到最大值
            slider.value = slider.max || 100;
            slider.dispatchEvent(new Event('input', { bubbles: true }));
            slider.dispatchEvent(new Event('change', { bubbles: true }));
            
            await this.sleep(300);
            this.log('设置最大卖出数量', 'info');
        } else {
            // 如果没有滑杆，尝试点击100%按钮
            const maxButton = Array.from(document.querySelectorAll('button, div')).find(btn => 
                btn.textContent.includes('100%') || btn.textContent.includes('Max')
            );
            
            if (maxButton) {
                maxButton.click();
                await this.sleep(300);
                this.log('点击最大数量按钮', 'info');
            } else {
                this.log('未找到数量设置控件', 'error');
            }
        }
    }

    async clickSellButton() {
        const sellButton = document.querySelector('.bn-button__sell') ||
                          document.querySelector('button[class*="sell"]') ||
                          Array.from(document.querySelectorAll('button')).find(btn => 
                              btn.textContent.includes('卖出') && !btn.disabled
                          );

        if (!sellButton) {
            throw new Error('未找到卖出按钮');
        }

        if (sellButton.disabled) {
            throw new Error('卖出按钮不可用');
        }

        sellButton.click();
        await this.sleep(1000);
        this.log('点击卖出按钮', 'success');

        // 检查并处理确认弹窗
        await this.handleSellConfirmationDialog();
    }

    async handleSellConfirmationDialog() {
        this.log('检查卖出确认弹窗...', 'info');
        
        // 等待弹窗出现
        await this.sleep(1000);
        
        // 查找确认弹窗中的"继续"按钮
        const confirmButton = this.findSellConfirmButton();
        
        if (confirmButton) {
            this.log('发现卖出确认弹窗，点击继续', 'info');
            confirmButton.click();
            await this.sleep(1000);
            this.log('确认卖出订单', 'success');
        } else {
            this.log('未发现卖出确认弹窗，继续执行', 'info');
        }
    }

    findSellConfirmButton() {
        // 方法1: 基于具体DOM结构查找 - 查找包含px-[24px] pb-[24px]的容器
        const confirmContainers = document.querySelectorAll('[class*="px-[24px]"][class*="pb-[24px]"]');
        for (const container of confirmContainers) {
            // 检查是否包含卖出相关信息
            if (container.textContent.includes('限价') && container.textContent.includes('卖出')) {
                const button = container.querySelector('button.bn-button.bn-button__primary');
                if (button && button.textContent.includes('继续')) {
                    return button;
                }
            }
        }

        // 方法2: 直接查找"继续"按钮
        let confirmButton = Array.from(document.querySelectorAll('button')).find(btn => 
            btn.textContent.trim() === '继续' && !btn.disabled
        );

        if (confirmButton) return confirmButton;

        // 方法3: 查找确认弹窗中的主要按钮
        confirmButton = document.querySelector('.bn-button__primary[class*="w-full"]') ||
                       document.querySelector('button.bn-button.bn-button__primary[class*="w-full"]');

        if (confirmButton && (confirmButton.textContent.includes('继续') || confirmButton.textContent.includes('确认'))) {
            return confirmButton;
        }

        // 方法4: 模糊匹配 - 查找任何包含确认信息的按钮
        const allButtons = document.querySelectorAll('button');
        for (const button of allButtons) {
            if ((button.textContent.includes('继续') || button.textContent.includes('确认')) && 
                !button.disabled && 
                button.offsetParent !== null) { // 确保按钮可见
                return button;
            }
        }

        return null;
    }

    async waitForSellComplete() {
        this.currentState = 'monitoring_sell';
        this.log('等待卖出订单完成...', 'info');

        return new Promise((resolve, reject) => {
            let checkCount = 0;
            const maxChecks = 120; // 最多检查2分钟
            
            this.orderCheckInterval = setInterval(async () => {
                checkCount++;
                
                if (!this.isRunning) {
                    clearInterval(this.orderCheckInterval);
                    resolve();
                    return;
                }

                if (checkCount > maxChecks) {
                    clearInterval(this.orderCheckInterval);
                    reject(new Error('卖出订单等待超时'));
                    return;
                }

                try {
                    const isComplete = await this.checkSellOrderComplete();
                    if (isComplete) {
                        clearInterval(this.orderCheckInterval);
                        this.log('卖出订单完成', 'success');
                        resolve();
                    }
                } catch (error) {
                    this.log(`检查卖出状态出错: ${error.message}`, 'error');
                }
            }, 1000);
        });
    }

    async checkSellOrderComplete() {
        // 首先检查是否有卖出委托记录存在
        const hasActiveSellOrder = await this.checkActiveSellOrder();
        
        if (!hasActiveSellOrder) {
            // 如果没有活跃的卖出委托，说明订单已经完成
            this.log('卖出委托记录已消失，订单完成', 'success');
            return true;
        } else {
            // 如果还有活跃的卖出委托，说明订单还在进行中
            this.log('卖出委托仍在进行中...', 'info');
            return false;
        }
    }

    async checkActiveSellOrder() {
        // 确保在当前委托选项卡
        await this.switchToCurrentOrders();
        
        // 查找当前委托表格中的卖出订单
        const orderRows = this.getOrderTableRows();
        
        for (const row of orderRows) {
            const rowText = row.textContent;
            
            // 检查是否包含卖出相关信息
            if (rowText.includes('卖出') || rowText.includes('Sell')) {
                // 进一步检查订单状态
                const statusCell = row.querySelector('td[aria-colindex="7"]'); // 状态列
                if (statusCell) {
                    const status = statusCell.textContent.trim();
                    // 如果状态是"新订单"、"部分成交"等，说明订单还在进行
                    if (status.includes('新订单') || status.includes('部分成交') || 
                        status.includes('New') || status.includes('Partial')) {
                        this.log(`发现活跃卖出订单，状态: ${status}`, 'info');
                        return true;
                    }
                }
            }
        }
        
        return false;
    }

    async debugSwitchToBuy() {
        this.log('=== 调试：开始切换到买入选项卡 ===', 'info');
        
        try {
            // 输出初始状态
            this.log('1. 检查初始状态:', 'info');
            this.debugTabState();
            
            // 查找买入选项卡元素
            this.log('2. 查找买入选项卡元素:', 'info');
            const buyTab1 = document.querySelector('#bn-tab-0');
            const buyTab2 = document.querySelector('.bn-tab__buySell[aria-controls="bn-tab-pane-0"]');
            const buyTab3 = document.querySelector('.bn-tab__buySell:first-child');
            
            this.log(`  #bn-tab-0: ${buyTab1 ? '找到' : '未找到'}`, 'info');
            this.log(`  .bn-tab__buySell[aria-controls="bn-tab-pane-0"]: ${buyTab2 ? '找到' : '未找到'}`, 'info');
            this.log(`  .bn-tab__buySell:first-child: ${buyTab3 ? '找到' : '未找到'}`, 'info');
            
            const buyTab = buyTab1 || buyTab2 || buyTab3;
            
            if (!buyTab) {
                this.log('❌ 未找到任何买入选项卡元素', 'error');
                return;
            }
            
            this.log(`✅ 使用元素: ${buyTab.id || buyTab.className}`, 'success');
            this.log(`  元素文本: "${buyTab.textContent.trim()}"`, 'info');
            this.log(`  aria-selected: ${buyTab.getAttribute('aria-selected')}`, 'info');
            this.log(`  aria-controls: ${buyTab.getAttribute('aria-controls')}`, 'info');
            this.log(`  classList: ${Array.from(buyTab.classList).join(', ')}`, 'info');
            
            // 检查是否已经激活
            this.log('3. 检查是否已经激活:', 'info');
            const isActive = this.isBuyTabActive();
            this.log(`  当前状态: ${isActive ? '已激活' : '未激活'}`, isActive ? 'success' : 'info');
            
            if (isActive) {
                this.log('✅ 已在买入选项卡，无需切换', 'success');
                return;
            }
            
            // 执行点击
            this.log('4. 执行点击操作:', 'info');
            buyTab.click();
            this.log('  已点击买入选项卡', 'info');
            
            // 等待切换结果
            this.log('5. 验证切换结果:', 'info');
            const switchSuccess = await this.waitForBuyTabSwitch();
            
            if (switchSuccess) {
                this.log('✅ 买入选项卡切换成功', 'success');
            } else {
                this.log('❌ 买入选项卡切换失败', 'error');
            }
            
            // 输出最终状态
            this.log('6. 最终状态:', 'info');
            this.debugTabState();
            
        } catch (error) {
            this.log(`❌ 调试过程出错: ${error.message}`, 'error');
        }
        
        this.log('=== 调试：买入切换完成 ===', 'info');
    }

    async debugSwitchToSell() {
        this.log('=== 调试：开始切换到卖出选项卡 ===', 'info');
        
        try {
            // 输出初始状态
            this.log('1. 检查初始状态:', 'info');
            this.debugTabState();
            
            // 查找卖出选项卡元素
            this.log('2. 查找卖出选项卡元素:', 'info');
            const sellTab1 = document.querySelector('#bn-tab-1');
            const sellTab2 = document.querySelector('.bn-tab__buySell[aria-controls="bn-tab-pane-1"]');
            const sellTab3 = document.querySelector('.bn-tab__buySell:nth-child(2)');
            
            this.log(`  #bn-tab-1: ${sellTab1 ? '找到' : '未找到'}`, 'info');
            this.log(`  .bn-tab__buySell[aria-controls="bn-tab-pane-1"]: ${sellTab2 ? '找到' : '未找到'}`, 'info');
            this.log(`  .bn-tab__buySell:nth-child(2): ${sellTab3 ? '找到' : '未找到'}`, 'info');
            
            const sellTab = sellTab1 || sellTab2 || sellTab3;
            
            if (!sellTab) {
                this.log('❌ 未找到任何卖出选项卡元素', 'error');
                return;
            }
            
            this.log(`✅ 使用元素: ${sellTab.id || sellTab.className}`, 'success');
            this.log(`  元素文本: "${sellTab.textContent.trim()}"`, 'info');
            this.log(`  aria-selected: ${sellTab.getAttribute('aria-selected')}`, 'info');
            this.log(`  aria-controls: ${sellTab.getAttribute('aria-controls')}`, 'info');
            this.log(`  classList: ${Array.from(sellTab.classList).join(', ')}`, 'info');
            
            // 检查是否已经激活
            this.log('3. 检查是否已经激活:', 'info');
            const isActive = this.isSellTabActive();
            this.log(`  当前状态: ${isActive ? '已激活' : '未激活'}`, isActive ? 'success' : 'info');
            
            if (isActive) {
                this.log('✅ 已在卖出选项卡，无需切换', 'success');
                return;
            }
            
            // 执行点击
            this.log('4. 执行点击操作:', 'info');
            sellTab.click();
            this.log('  已点击卖出选项卡', 'info');
            
            // 等待切换结果
            this.log('5. 验证切换结果:', 'info');
            const switchSuccess = await this.waitForSellTabSwitch();
            
            if (switchSuccess) {
                this.log('✅ 卖出选项卡切换成功', 'success');
            } else {
                this.log('❌ 卖出选项卡切换失败', 'error');
            }
            
            // 输出最终状态
            this.log('6. 最终状态:', 'info');
            this.debugTabState();
            
        } catch (error) {
            this.log(`❌ 调试过程出错: ${error.message}`, 'error');
        }
        
        this.log('=== 调试：卖出切换完成 ===', 'info');
    }

    clearLogs() {
        this.logContainer.innerHTML = '';
        this.log('日志已清空', 'info');
    }

    log(message, type = 'info') {
        const timestamp = new Date().toLocaleTimeString();
        const logItem = document.createElement('div');
        logItem.className = `log-item ${type}`;
        logItem.textContent = `[${timestamp}] ${message}`;
        
        this.logContainer.appendChild(logItem);
        this.logContainer.scrollTop = this.logContainer.scrollHeight;

        // 保持最多50条日志
        if (this.logContainer.children.length > 50) {
            this.logContainer.removeChild(this.logContainer.firstChild);
        }

        console.log(`[Binance Auto Trader] ${message}`);
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// 检查是否在币安Alpha交易页面
if (window.location.href.includes('binance.com/zh-CN/alpha/')) {
    // 等待页面加载完成
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            setTimeout(() => new BinanceAutoTrader(), 2000);
        });
    } else {
        setTimeout(() => new BinanceAutoTrader(), 2000);
    }
} else {
    console.log('Binance Auto Trader: 不在支持的页面');
}