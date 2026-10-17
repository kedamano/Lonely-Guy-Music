// 界面语言：简体中文 / 繁體中文 / English。
// 实现方式：运行时字典替换（DOM 文本节点 + title/aria-label/placeholder 属性），
// 动态句子用模板模式（{n} 占位）匹配，切回简体时还原原文。
// 好处：无需重构所有 el() 调用，设置页切换语言即时生效。

let lang = 'zh-CN';

/* ---------- 静态文案字典（键为简体中文原文） ---------- */
const ZH_TW = {
  // 导航 / 侧栏
  发现: '發現', 音乐馆: '音樂館', 搜索: '搜尋', 本地音乐: '本地音樂', 我的: '我的', 设置: '設定',
  声场: '聲場', 快捷电台: '快捷電臺', 治愈电台: '治愈電臺', 摇滚能量: '搖滾能量',
  深夜Emo: '深夜Emo', 通勤回血: '通勤回血',
  // 标题栏 / 徽标
  离线示例: '離線示例', 在线曲库: '線上曲庫', 未在播放: '未在播放', 未选择歌曲: '未選擇歌曲',
  迷你模式: '迷你模式', 最小化: '最小化', 最大化: '最大化', 还原: '還原', 关闭: '關閉',
  打开正在播放: '開啟正在播放', 回到发现: '回到發現',
  // 播放控制
  播放: '播放', 暂停: '暫停', 上一首: '上一首', 下一首: '下一首', 播放队列: '播放佇列',
  播放全部: '播放全部', 随机播放: '隨機播放', 加入队列: '加入佇列', 加入播放队列: '加入播放佇列',
  清空: '清空', 清空队列: '清空佇列', 收藏: '收藏', 取消收藏: '取消收藏', 静音: '靜音',
  取消静音: '取消靜音', 顺序播放: '順序播放', 列表循环: '清單循環', 单曲循环: '單曲循環',
  从头播放: '從頭播放', 下载这首歌: '下載這首歌', 下载: '下載', 歌词: '歌詞',
  // 视图
  返回: '返回', 重试: '重試', 继续搜索: '繼續搜尋', 播放历史: '播放歷史', 全部历史: '全部歷史',
  收藏夹: '收藏夾', 等待第一首歌: '等待第一首歌', 随机来一首: '隨機來一首',
  '随机来一首，点亮声场': '隨機來一首，點亮聲場', 去发现: '去發現', 去发现音乐: '去發現音樂',
  去搜索: '去搜尋', 移除: '移除', 删除: '刪除', 移出队列: '移出佇列', 选择文件: '選擇檔案',
  选择文件夹: '選擇資料夾', 浏览音乐馆: '瀏覽音樂館', 热门搜索: '熱門搜尋', 最近搜索: '最近搜尋',
  清除: '清除', 清空搜索: '清空搜尋', 全部: '全部', 华语: '華語', 欧美: '歐美', 日语: '日語',
  韩语: '韓語', 轻音乐: '輕音樂', 摇滚: '搖滾', 自定义: '自訂',
  // 空态 / 提示
  这里还是空的: '這裡還是空的', 还没有本地音乐: '還沒有本地音樂', 还没有收藏: '還沒有收藏',
  还没有播放历史: '還沒有播放歷史', 队列是空的: '佇列是空的', 队列已经是空的: '佇列已經是空的',
  这些歌曲已在队列中: '這些歌曲已在佇列中', 这里还没有可播放的歌曲: '這裡還沒有可播放的歌曲',
  这个歌单还没有歌曲: '這個歌單還沒有歌曲', 没有找到歌单: '沒有找到歌單', 加载失败: '載入失敗',
  网络异常: '網路異常', 已收藏: '已收藏', 已取消收藏: '已取消收藏', 已从本地曲库移除: '已從本地曲庫移除',
  已从队列移除: '已從佇列移除', 已加入队列: '已加入佇列', 已清空: '已清空', 已删除: '已刪除',
  已启用: '已啟用', 已停用: '已停用', 已导入: '已匯入', 已安装: '已安裝', 已保存到: '已儲存到',
  正在导入音源: '正在匯入音源', 正在读取音源: '正在讀取音源', 正在下载: '正在下載',
  正在播放: '正在播放', 点击跳转: '點擊跳轉', 聚焦搜索: '聚焦搜尋', 打开歌单: '開啟歌單',
  确定删除这个音源: '確定刪除這個音源', 清空全部收藏: '清空全部收藏', 清空播放历史: '清空播放歷史',
  先播放一首歌曲: '先播放一首歌曲', 先选择一首歌曲: '先選擇一首歌曲', 本地文件可直接在原位置查看: '本地檔案可直接在原位置檢視',
  '睡眠定时结束，音乐已淡出': '睡眠定時結束，音樂已淡出', 还没有正在播放的歌曲: '還沒有正在播放的歌曲',
  播放或暂停: '播放或暫停', 音量: '音量', 播放进度: '播放進度',
  // 设置
  基本设置: '基本設定', 播放设置: '播放設定', 播放详情页设置: '播放詳情頁設定', 桌面歌词: '桌面歌詞',
  列表设置: '清單設定', 下载设置: '下載設定', 网络代理: '網路代理', 自定义源管理: '自訂源管理',
  播放与快捷键: '播放與快速鍵', 关于: '關於', 音乐来源: '音樂來源', 默认音质: '預設音質',
  歌词页背景: '歌詞頁背景', 封面模糊: '封面模糊', 封面主色: '封面主色', 应用背景: '應用背景',
  主题颜色: '主題顏色', 信号琥珀: '訊號琥珀', 霓虹紫: '霓虹紫', 电子青: '電子青', 玫红: '玫紅',
  窗口尺寸: '視窗尺寸', 字体大小: '字型大小', 语言: '語言', 简体中文: '簡體中文', 繁體中文: '繁體中文',
  显示动画效果: '顯示動畫效果', 更小: '更小', 小: '小', 标准: '標準', 大: '大', 更大: '更大',
  非常大: '非常大', 启动软件后自动播放音乐: '啟動軟體後自動播放音樂', 播放歌曲时阻止电脑休眠: '播放歌曲時阻止電腦休眠',
  记住播放进度: '記住播放進度', 播放错误时自动切换歌曲: '播放錯誤時自動切換歌曲', 使用卡拉OK样式歌词播放: '使用卡拉OK樣式歌詞播放',
  在任务栏上显示当前歌曲播放进度: '在工作列上顯示目前歌曲播放進度', 缩放当前正在播放的歌曲: '縮放目前正在播放的歌曲',
  延迟歌词滚动: '延遲歌詞滾動', 允许通过拖拽歌词调整播放进度: '允許透過拖曳歌詞調整播放進度', 歌词对齐方式: '歌詞對齊方式',
  显示桌面歌词: '顯示桌面歌詞', 歌词字体颜色: '歌詞字型顏色', 桌面歌词对齐方式: '桌面歌詞對齊方式',
  桌面歌词加粗: '桌面歌詞加粗', 桌面歌词字号: '桌面歌詞字型大小', 锁定桌面歌词: '鎖定桌面歌詞',
  显示歌曲来源平台: '顯示歌曲來源平臺', 记住播放列表滚动位置: '記住播放清單捲動位置',
  双击列表里的歌曲时自动切换到当前列表播放: '點兩下清單裡的歌曲時自動切換到目前清單播放',
  添加歌曲到播放列表的位置: '新增歌曲到播放清單的位置', 顶部: '頂部', 底部: '底部',
  启用下载功能: '啟用下載功能', 下载路径: '下載路徑', 文件命名方式: '檔案命名方式',
  歌曲名: '歌曲名', 艺术家: '藝術家', 未播放: '未播放', 已播放: '已播放', 阴影: '陰影',
  中: '中', 左: '左', 右: '右', 上一页: '上一頁', 下一页: '下一頁',
  // 分页单位
  项: '項', 首: '首', 首歌曲: '首歌曲', 个歌单: '個歌單',
  保存代理: '儲存代理', 从URL安装: '從URL安裝', 导入本地: '匯入本地',
  快捷键: '快速鍵', 快退: '快退', 快进: '快進', 秒: '秒', 打开歌词: '開啟歌詞',
  播放队列抽屉: '播放佇列抽屜', 关闭声场: '關閉聲場', 关闭队列: '關閉佇列',
  外观: '外觀', 睡眠定时: '睡眠定時', 图形均衡器: '圖形等化器', 扁平: '扁平', 实时频谱: '即時頻譜',
  播放结束淡出关闭: '播放結束淡出關閉',
  // 账号与登录
  登录网易云账号: '登入網易雲帳號', 匿名账号: '匿名帳號', 已登录: '已登入', 未登录: '未登入',
  '游客态 · 建议在 App 内登录主账号': '訪客態 · 建議在 App 內登入主帳號',
  '黑胶会员 · 已同步': '黑膠會員 · 已同步', '网易云用户 · 已同步': '網易雲用戶 · 已同步',
  '当前是网易云游客账号，收藏与推荐可用，但没有昵称头像': '目前是網易雲訪客帳號，收藏與推薦可用，但沒有暱稱與頭像',
  扫码登录网易云: '掃碼登入網易雲', '曲库离线，暂无法登录': '曲庫離線，暫無法登入',
  '网易云接口不可达，无法登录': '網易雲介面不可達，無法登入', 每日推荐: '每日推薦',
  我收藏的歌单: '我收藏的歌單', 账号信息: '帳號資訊', 退出登录: '登出', 昵称: '暱稱', 等级: '等級',
  会员: '會員', 黑胶会员: '黑膠會員', 普通用户: '普通用戶', 账号类型: '帳號類型',
  '游客态（网易云未返回资料页）': '訪客態（網易雲未回傳資料頁）',
  '这个账号是在网易云 App 里以游客态扫码的：收藏、订阅、每日推荐都可用，但昵称头像不存在。想要个性化推荐，请在 App 内登录主账号后回来重新扫码。':
    '這個帳號是在網易雲 App 裡以訪客態掃碼的：收藏、訂閱、每日推薦都可用，但暱稱頭像不存在。想要個人化推薦，請在 App 內登入主帳號後回來重新掃碼。',
  '个性签名：': '個人簽名：',
  '登录凭证保存在本机，不会发送到界面层。': '登入憑證保存在本機，不會傳送到介面層。',
  知道了: '知道了', 已退出登录: '已登出', 退出失败: '登出失敗',
  '二维码已过期，正在刷新…': 'QR Code 已過期，正在重新整理…',
  '等待扫码 · 请用网易云音乐 App 扫二维码': '等待掃碼 · 請用網易雲音樂 App 掃描 QR Code',
  '已扫码 · 请在手机上确认登录': '已掃描 · 請在手機上確認登入', 登录成功: '登入成功',
  '网易云接口不可达，暂时无法登录': '網易雲介面不可達，暫時無法登入',
  正在生成二维码: '正在產生 QR Code', '扫码并在手机上确认后自动登录；凭证仅保存在本机用户目录。':
    '掃描並在手機上確認後自動登入；憑證僅保存在本機使用者目錄。',
  扫码登录: '掃碼登入', '打开网易云音乐 App → 我的 → 右上角扫码。': '開啟網易雲音樂 App → 我的 → 右上角掃碼。',
  取消: '取消', 未取得登录密钥: '未取得登入金鑰', 登录二维码: '登入 QR Code',
  二维码生成失败: 'QR Code 產生失敗', 重新生成: '重新產生', 登录状态查询失败: '登入狀態查詢失敗', 网易云用户: '網易雲用戶', 等待扫码: '等待掃碼',
  换主账号登录: '改登入主帳號', 不再提示: '不再提示',
  // 首屏 / 发现
  声场面板: '聲場面板', '播放/暂停': '播放/暫停', 循环模式: '循環模式',
  '把任意设备的扬声器，变成一台声场仪表盘。在线曲库 × 本地音乐 × 实时频谱。':
    '把任何裝置的喇叭，變成一台聲場儀表板。線上曲庫 × 本地音樂 × 即時頻譜。',
  '在<em>深夜</em><br>听见自己': '在<em>深夜</em><br>聽見自己',
  '聚合精选歌单，一键播放；打开声场面板，实时频谱、图形均衡器与睡眠定时都已就位。':
    '彙整精選歌單，一鍵播放；開啟聲場面板，即時頻譜、圖形等化器與睡眠定時都已就緒。',
  '精选歌单 <span class="section__sub">每日更新</span>': '精選歌單 <span class="section__sub">每日更新</span>',
  '继续聆听 <span class="section__sub">最近播放</span>': '繼續聆聽 <span class="section__sub">最近播放</span>',
  歌单加载失败: '歌單載入失敗', 推荐新歌: '推薦新歌', 根据你的收听历史生成: '依你的收聽歷史產生',
  网易云近期上新: '網易雲近期上新', 换一批: '換一批', 登录网易云解锁属于你的每日推荐: '登入網易雲，解鎖属于你的每日推薦',
  '登录网易云，解锁属于你的每日推荐': '登入網易雲，解鎖属于你的每日推薦',
  按风格浏览热门歌单: '依風格瀏覽熱門歌單', '按风格浏览热门歌单。': '依風格瀏覽熱門歌單。',
  '实时搜索网易云曲库：输入即搜，回车立即执行。': '即時搜尋網易雲曲庫：輸入即搜，Enter 立即執行。',
  '想听点什么？歌曲 / 歌单 / 艺人': '想聽點什麼？歌曲 / 歌單 / 藝人',
  歌曲: '歌曲', 歌单: '歌單', 搜索失败: '搜尋失敗',
  '换一个关键词，或者试试下方热门搜索。': '換一個關鍵字，或試試下方熱門搜尋。',
  '换一个关键词，或切到歌曲搜索。': '換一個關鍵字，或切到歌曲搜尋。',
  搜歌曲: '搜歌曲',
  // 本地音乐
  '导入的曲目登记在本机清单里，重启后依然在。': '匯入的曲目登記在本機清單裡，重啟後依然在。',
  '导入本地音频，用同一套播放器与声场播放。': '匯入本地音訊，用同一套播放器與聲場播放。',
  把音频文件拖到这里: '把音訊檔案拖到這裡',
  '·  支持 mp3 / flac / wav / ogg / m4a / aac': '·  支援 mp3 / flac / wav / ogg / m4a / aac',
  '把 mp3 / flac 等文件拖进上方区域，或通过按钮导入。导入后即可用均衡器与频谱播放。':
    '把 mp3 / flac 等檔案拖進上方區域，或透過按鈕匯入。匯入後即可用等化器與頻譜播放。',
  打开文件对话框失败: '開啟檔案對話框失敗', 打开目录对话框失败: '開啟目錄對話框失敗',
  '正在扫描目录，请稍候…': '正在掃描目錄，請稍候…', 扫描失败: '掃描失敗', 目录不可读: '目錄不可讀',
  导入失败: '匯入失敗', 无法读取所选文件: '無法讀取所選檔案', 没有可导入的音频文件: '沒有可匯入的音訊檔案',
  这些曲目已经在曲库里了: '這些曲目已經在曲庫裡了', 本地文件: '本地檔案',
  '浏览器环境无法扫描目录，请改用文件选择': '瀏覽器環境無法掃描目錄，請改用檔案選擇',
  // 我的 / 队列 / 收藏 / 歌单
  历史: '歷史', 队列: '佇列', 我的歌单: '我的歌單', 订阅歌单: '訂閱歌單', 云歌单: '雲歌單',
  '收藏、播放历史、当前队列、本地歌单与网易云账号歌单。': '收藏、播放歷史、目前佇列、本地歌單與網易雲帳號歌單。',
  '登录后查看云端歌单': '登入後查看雲端歌單',
  '登录网易云账号后，这里会列出你在云端创建与收藏的全部歌单，还能直接播放「我喜欢的音乐」——换设备也不会丢。': '登入網易雲帳號後，這裡會列出你在雲端建立與收藏的全部歌單，還能直接播放「我喜歡的音樂」——換裝置也不會丟。',
  '我喜欢的音乐': '我喜歡的音樂',
  '我喜欢的音乐 / 我创建的歌单': '我喜歡的音樂 / 我建立的歌單',
  我收藏的歌单: '我收藏的歌單',
  '直接在账号歌单上播放，只读不改动云端数据': '直接在帳號歌單上播放，唯讀不改動雲端資料',
  刷新: '重新整理',
  '正在同步云端歌单…': '正在同步雲端歌單…',
  '云端歌单加载失败': '雲端歌單載入失敗',
  '未取到账号 UID': '未取得帳號 UID',
  '当前登录态缺少用户资料（多为游客态）。请在网易云 App 内登录主账号后重新扫码。': '目前登入狀態缺少使用者資料（多為遊客態）。請在網易雲 App 內登入主帳號後重新掃碼。',
  '正在读取「我喜欢的音乐」…': '正在讀取「我喜歡的音樂」…',
  // 登录
  '登录网易云': '登入網易雲',
  手机号: '手機號', 邮箱: '電子郵件', 验证码: '驗證碼', 短信验证码: '簡訊驗證碼',
  获取验证码: '取得驗證碼', 密码: '密碼', 网易云密码: '網易雲密碼',
  '登录': '登入', '登录中…': '登入中…',
  '验证码已发送，请查收短信': '驗證碼已發送，請查收簡訊',
  '验证码由网易云发送；国内手机号默认 +86。': '驗證碼由網易雲發送；中國大陸手機號預設 +86。',
  '使用网易云音乐主站账号密码；开启二次验证的账号建议改用扫码。': '使用網易雲音樂主站帳號密碼；開啟兩步驟驗證的帳號建議改用掃碼。',
  '扫码最快；手机号与邮箱走网易云官方登录接口。凭证只保存在本机用户目录，界面层拿不到。': '掃碼最快；手機號與電子郵件走網易雲官方登入介面。憑證只保存在本機使用者目錄，介面層拿不到。',
  // 音效
  日志目录: '日誌目錄', '运行日志仅保存在本机，排查故障时提供给开发者': '執行日誌僅保存在本機，排查故障時提供給開發者',
  音效: '音效', 空间宽度: '空間寬度', 混响强度: '殘響強度', 恢复场景默认: '恢復場景預設',
  关闭: '關閉', 录音室: '錄音室', 现场: '現場', 耳机: '耳機', 夜间: '夜間',
  '空间音频与场景预设直接作用于 Web Audio 音频链，播放中即时生效；与上面的 10 段均衡器叠加使用。': '空間音訊與場景預設直接作用於 Web Audio 音訊鏈，播放中即時生效；與上方的 10 段等化器疊加使用。',
  '原始音频直通，不做任何染色': '原始音訊直通，不做任何染色',
  '干净紧致的监听感，几乎无混响': '乾淨緊緻的監聽感，幾乎無殘響',
  '厅堂混响 + 更宽声场，像站在台下': '廳堂殘響 + 更寬聲場，像站在台下',
  '强化低频与声场包裹感，适合入耳式': '強化低頻與聲場包覆感，適合入耳式',
  '收窄动态范围，深夜不炸耳': '收窄動態範圍，深夜不炸耳',
  '100% 为原始立体声；调高拉宽声场，过高会显得中空。': '100% 為原始立體聲；調高拉寬聲場，過高會顯得中空。',
  '模拟房间反射；各场景自带不同默认值，可在此微调。': '模擬房間反射；各場景自帶不同預設值，可在此微調。',
  // 多平台搜索
  网易云音乐: '網易雲音樂', 酷狗音乐: '酷狗音樂', 搜索平台: '搜尋平台',
  'QQ 音乐': 'QQ 音樂', 网易云: '網易雲', 酷狗: '酷狗',
  '多平台搜索：网易云 / QQ 音乐 / 酷狗，输入即搜，回车立即执行。': '多平台搜尋：網易雲 / QQ 音樂 / 酷狗，輸入即搜，Enter 立即執行。',
  播放队列是空的: '播放佇列是空的',
  '在曲目行悬停点击＋，或播放任意歌单来填充队列。': '在曲目列游標懸停點擊＋，或播放任意歌單來填充佇列。',
  队列已清空: '佇列已清空',
  '在播放条或任意曲目行点击 ♥，喜欢的歌会出现在这里。': '在播放列或任意曲目列點擊 ♥，喜歡的歌會出現在這裡。',
  '播放过的歌曲会自动记录在这里。': '播放過的歌曲會自動記錄在這裡。',
  已移除: '已移除', 打开: '開啟', 重命名: '重新命名', 删除歌单: '刪除歌單', 新建歌单: '新建歌單',
  歌单名称: '歌單名稱', '例如：深夜写代码': '例如：深夜寫程式', 创建: '建立',
  歌单名称不能为空: '歌單名稱不能為空', 重命名歌单: '重新命名歌單', 保存: '儲存', 已重命名: '已重新命名',
  已删除歌单: '已刪除歌單', "新建歌单…": '新建歌單…', 这首歌已经在歌单里了: '這首歌已經在歌單裡了',
  还没有本地歌单: '還沒有本地歌單',
  '在任何曲目上右键 → 加入歌单，就能把散落的歌收进一个袋子里；歌单只保存在本机，重启也在。':
    '在任意曲目上右鍵 → 加入歌單，就能把散落的歌收進一個袋子裡；歌單只保存在本機，重啟也在。',
  新建第一个歌单: '新建第一個歌單', 歌单不存在或已删除: '歌單不存在或已刪除', 回到我的: '回到我的',
  这些本地曲目已不在曲库: '這些本地曲目已不在曲庫', 这个歌单还是空的: '這個歌單還是空的',
  '本地文件被移动或删除后无法播放，可在「本地音乐」重新导入。':
    '本地檔案被移動或刪除後無法播放，可在「本地音樂」重新匯入。',
  '在任意曲目行右键 → 加入歌单，把歌收进来。': '在任意曲目列右鍵 → 加入歌單，把歌收進來。',
  去本地音乐: '去本地音樂', 已从歌单移除: '已從歌單移除', 移出歌单: '移出歌單', 下一首播放: '下一首播放',
  加入歌单: '加入歌單', '加入歌单…': '加入歌單…', 本机: '本機', 自建: '自建', 云端: '雲端',
  同步到网易云: '同步到網易雲', 已收藏歌单: '已收藏歌單', 已取消收藏歌单: '已取消收藏歌單',
  网易云端同步失败: '網易雲端同步失敗', 接口不可用: '介面不可用', 同步失败: '同步失敗',
  请先登录网易云账号: '請先登入網易雲帳號',
  账号信息缺少请在账号菜单里退出后重新扫码: '帳號資訊缺少 UID，請在帳號選單裡登出後重新掃碼',
  '账号信息缺少 UID，请在账号菜单里退出后重新扫码': '帳號資訊缺少 UID，請在帳號選單裡登出後重新掃碼',
  '正在拉取云端歌单…': '正在抓取雲端歌單…', 云端还没有歌单: '雲端還沒有歌單', 拉取失败: '抓取失敗',
  同时取消云端: '同時取消雲端', 只删本机: '只刪本機', 云端取消失败: '雲端取消失敗',
  已从本机与网易云取消收藏: '已從本機與網易雲取消收藏', 已从本机取消收藏: '已從本機取消收藏',
  导入歌单: '匯入歌單', 网易云歌单链接或: '網易雲歌單連結或 ID', '网易云歌单链接或 ID': '網易雲歌單連結或 ID',
  没有识别到歌单: '沒有識別到歌單 ID', '没有识别到歌单 ID': '沒有識別到歌單 ID',
  '正在读取歌单…': '正在讀取歌單…', 歌单不存在或无权访问: '歌單不存在或無權存取', 歌单不存在: '歌單不存在',
  全部只存在本机点拉取云端合并账号里的歌单: '全部只存在本機，點「抓取雲端」合併帳號裡的歌單',
  '全部只存在本机，点「拉取云端」合并账号里的歌单': '全部只存在本機，點「抓取雲端」合併帳號裡的歌單',
  '登录后可与网易云收藏互相同步': '登入後可與網易雲收藏互相同步', 拉取云端歌单: '抓取雲端歌單',
  导入歌单链接: '匯入歌單連結', 还没有收藏在线歌单: '還沒有收藏線上歌單',
  '点「拉取云端歌单」把你网易云账号里的歌单一次搬进来；也可以粘贴链接或去音乐馆收藏。':
    '點「抓取雲端歌單」把你網易雲帳號裡的歌單一次搬進來；也可以貼上連結或去音樂館收藏。',
  '在歌单详情页点「收藏歌单」，或粘贴网易云歌单链接导入。登录后可以与网易云互相同步。':
    '在歌單詳情頁點「收藏歌單」，或貼上網易雲歌單連結匯入。登入後可與網易雲互相同步。',
  登录网易云: '登入網易雲', 去音乐馆: '去音樂館', 收藏歌单: '收藏歌單', 试试其他歌单: '試試其他歌單。',
  '试试其他歌单。': '試試其他歌單。', 已在播放队列中: '已在播放佇列中', 暂无可播放内容: '暫無可播放內容',
  随机播放失败: '隨機播放失敗', 播放列表已结束: '播放清單已結束', 已淡出并暂停: '已淡出並暫停',
  // 歌词 / 播放条
  '专辑 · {album}': '專輯 · {album}', 本地音乐暂无歌词: '本地音樂暫無歌詞',
  '暂无歌词 · 请欣赏旋律': '暫無歌詞 · 請欣賞旋律', 上下拖拽调整播放进度: '上下拖曳調整播放進度',
  '播放歌曲或点击曲目行的＋加入队列。': '播放歌曲或點擊曲目列的＋加入佇列。',
  '随机播放：开': '隨機播放：開', '随机播放：关': '隨機播放：關', 播放队列为空: '播放佇列為空',
  随机播放已开启: '隨機播放已開啟', 随机播放已关闭: '隨機播放已關閉',
  下载功能已在设置下载设置中关闭: '下載功能已在設定 → 下載設定中關閉',
  '下载功能已在设置 → 下载设置中关闭': '下載功能已在設定 → 下載設定中關閉',
  无法获取该歌曲的下载地址: '無法取得該歌曲的下載網址', '下载失败（HTTP': '下載失敗（HTTP',
  已连接网易云曲库: '已連線網易雲曲庫', '网易云接口暂不可达，使用内置示例曲库': '網易雲介面暫不可達，使用內建示例曲庫',
  '孤男音乐 · 桌面声场': '孤男音樂 · 桌面聲場', 解锁: '解鎖', '锁定（鼠标穿透）': '鎖定（滑鼠穿透）',
  音源与官方接口均无可用地址可能无版权或已下架: '音源與官方介面均無可用網址（可能無版權或已下架）',
  '音源与官方接口均无可用地址（可能无版权或已下架）': '音源與官方介面均無可用網址（可能無版權或已下架）',
  播放被浏览器拦截: '播放被瀏覽器封鎖',
  '音频地址无效或格式不支持（音源可能已失效）': '音訊網址無效或格式不支援（音源可能已失效）',
  '网络中断，请稍后重试': '網路中斷，請稍後重試', 音频解码失败: '音訊解碼失敗', 被浏览器拦截: '被瀏覽器封鎖',
  'FLAC 无损': 'FLAC 無損', 超大: '超大', '歌曲名 - 艺术家': '歌曲名 - 藝人', '艺术家 - 歌曲名': '藝人 - 歌曲名',
  空格: '空白鍵', '播放 / 暂停': '播放 / 暫停', '快退 / 快进 5 秒': '快退 / 快進 5 秒', '音量 ±5%': '音量 ±5%',
  关闭浮层: '關閉浮層', 减小字号: '縮小字型', 增大字号: '放大字型', 关闭桌面歌词: '關閉桌面歌詞',
  当前: '目前', 更改: '變更', 确定: '確定', 输入: '輸入', 对话框: '對話框', 确认操作: '確認操作',
  换个分类或关键词试试: '換個分類或關鍵字試試。', '换个分类或关键词试试。': '換個分類或關鍵字試試。',
  // 带全角标点的提示语变体（tr 按整句精确匹配，必须原样收录）
  '退出失败：': '登出失敗：', '正在生成二维码…': '正在產生 QR Code…', '已登录：': '已登入：',
  '等待扫码…': '等待掃碼…', 未命名歌单: '未命名歌單', 未知艺人: '未知藝人', 未知曲目: '未知曲目',
  当前是网易云游客账号: '目前是網易雲訪客帳號',
  '收藏、订阅、播放记录都能正常用，但网易云没有给这个账号昵称和头像，个性化推荐也基本是空的。':
    '收藏、訂閱、播放記錄都能正常用，但網易雲沒有給這個帳號暱稱與頭像，個人化推薦也基本是空的。',
  '请在手机网易云 App 里确认已登录主账号，再回来重新扫码。':
    '請在手機網易雲 App 裡確認已登入主帳號，再回來重新掃碼。',
  '打开文件对话框失败：': '開啟檔案對話框失敗：', '打开目录对话框失败：': '開啟目錄對話框失敗：',
  '扫描失败：': '掃描失敗：', '导入失败：': '匯入失敗：', '网易云端同步失败：': '網易雲端同步失敗：',
  '同步失败：': '同步失敗：', '拉取失败：': '抓取失敗：', '云端取消失败：': '雲端取消失敗：',
  '随机播放失败：': '隨機播放失敗：', '下载失败：': '下載失敗：', '设置音质失败：': '設定音質失敗：',
  '选择目录失败：': '選擇目錄失敗：', '保存失败：': '儲存失敗：', '安装失败：': '安裝失敗：',
  '切换失败：': '切換失敗：', '删除失败：': '刪除失敗：',
  '上下拖拽歌词行快进/快退': '上下拖曳歌詞行快進/快退', '未设置（每次询问）': '未設定（每次詢問）',
  离线示例曲库: '離線示例曲庫', 网易: '網易', '已关闭代理（恢复直连）': '已關閉代理（恢復直連）',
  '点击播放条封面打开的歌词大页。': '點擊播放列封面開啟的歌詞大頁。',
  '从 URL 安装': '從 URL 安裝', 本地: '本地', 网易云: '網易雲',
  '播放、外观、歌词、列表与下载，全部选项即时生效。': '播放、外觀、歌詞、清單與下載，全部選項即時生效。',
  '动画、主题、窗口与字体，随时切换即时生效。': '動畫、主題、視窗與字型，隨時切換即時生效。',
  '关闭后减少界面动效，低性能设备更流畅': '關閉後減少介面動效，低效能裝置更流暢',
  '全站强调色，影响按钮、频谱、氛围光': '全站強調色，影響按鈕、頻譜、氛圍光',
  '切换后整个界面立即转换，可随时切回': '切換後整個介面立即轉換，可隨時切回',
  '搜索使用网易云元数据，播放时优先调用下方已启用的自定义音源获取真实链接；失败会自动降级到官方接口。':
    '搜尋使用網易雲中繼資料，播放時優先呼叫下方已啟用的自訂音源取得真實連結；失敗會自動降級到官方介面。',
  启动时自动接着播放上次的歌曲: '啟動時自動接著播放上次的歌曲',
  播放期间系统不会进入睡眠: '播放期間系統不會進入睡眠',
  再次播放同一首歌时恢复到上次位置: '再次播放同一首歌時恢復到上次位置',
  取链或播放失败时自动播放下一首: '取鏈或播放失敗時自動播放下一首',
  已播放的歌词逐字高亮: '已播放的歌詞逐字高亮',
  'Windows 任务栏图标显示播放进度': 'Windows 工作列圖示顯示播放進度',
  "当前歌词行放大，其余行淡出": '目前歌詞行放大，其餘行淡出',
  '歌词稍晚跟随播放进度，适合跟唱': '歌詞稍晚跟隨播放進度，適合跟唱',
  '在桌面上显示一层置顶歌词，可锁定位置。': '在桌面上顯示一層置頂歌詞，可鎖定位置。',
  在屏幕底部显示置顶歌词窗口: '在螢幕底部顯示置頂歌詞視窗',
  '未播放 / 已播放 / 阴影颜色': '未播放 / 已播放 / 陰影顏色',
  '锁定后鼠标事件穿透，不会挡住桌面操作': '鎖定後滑鼠事件穿透，不會擋住桌面操作',
  在曲目名后标注来源平台: '在曲目名後標註來源平臺',
  返回列表时恢复上次浏览位置: '返回列表時恢復上次瀏覽位置',
  双击直接用当前列表替换播放队列: '雙擊直接用目前清單替換播放佇列',
  '把在线歌曲保存到本地，文件名按下方规则生成。': '把線上歌曲儲存到本地，檔名依下方規則產生。',
  在曲目行与歌词页显示下载按钮: '在曲目列與歌詞頁顯示下載按鈕',
  留空则每次下载时询问保存位置: '留空則每次下載時詢問儲存位置',
  已恢复每次询问: '已恢復每次詢問', 恢复询问: '恢復詢問',
  '音源的网络请求默认直连，不读取系统代理。仅当你的网络必须通过代理才能访问音源接口时，才需要填写；保存后立即生效，无需重启。':
    '音源的網路請求預設直連，不讀取系統代理。僅當你的網路必須透過代理才能存取音源介面時才需要填寫；儲存後立即生效，無需重啟。',
  '兼容 LX Music 自定义音源脚本。导入后启用，播放时会优先用音源取链；全部失败才降级官方接口。':
    '相容 LX Music 自訂音源腳本。匯入後啟用，播放時會優先使用音源取鏈；全部失敗才降級官方介面。',
  '导入本地 .js': '匯入本地 .js', '正在读取音源…': '正在讀取音源…',
  '支持系统媒体键与托盘控制。以下快捷键在非输入状态下生效。': '支援系統媒體鍵與托盤控制。以下快速鍵在非輸入狀態下生效。',
  '在线曲库（网易云）': '線上曲庫（網易雲）',
  '在线曲库依赖第三方接口，仅供学习研究；本地音乐与自定义音源均在本机处理。':
    '線上曲庫依賴第三方介面，僅供學習研究；本地音樂與自訂音源均在本機處理。',
  音源列表加载失败: '音源清單載入失敗', 暂无自定义音源: '暫無自訂音源',
  '导入本地 .js 或从 URL 安装音源脚本。未安装时仍可使用官方接口或离线示例。':
    '匯入本地 .js 或從 URL 安裝音源腳本。未安裝時仍可使用官方介面或離線示例。',
  初始化失败: '初始化失敗', 当前环境不支持选择目录: '目前環境不支援選擇目錄',
  下载路径已设置: '下載路徑已設定', '当前状态：未使用代理，音源请求直连': '目前狀態：未使用代理，音源請求直連',
  音源脚本: '音源腳本', '正在导入音源…': '正在匯入音源…',
  '请输入音源脚本 URL': '請輸入音源腳本 URL', '正在下载…': '正在下載…',
  音源已启用: '音源已啟用', 音源已停用: '音源已停用', '确定删除这个音源？': '確定刪除這個音源？',
  歌词翻译: '歌詞翻譯', 只看原文: '只看原文', 只看译文: '只看譯文', 双语对照: '雙語對照',
  歌词显示: '歌詞顯示', 翻译这首歌: '翻譯這首歌', '正在翻译…': '正在翻譯…',
  译文已就绪: '譯文已就緒', '翻译失败，点此重试': '翻譯失敗，點此重試',
  '未配置翻译服务或翻译失败': '未設定翻譯服務或翻譯失敗', 翻译失败: '翻譯失敗',
  '译文按界面语言生成：简体/繁体界面译成中文，英文界面译成英文':
    '譯文依介面語言產生：簡體／繁體介面譯成中文，英文介面譯成英文',
  '优先使用网易云自带的官方译文；没有译文时，点歌词页的「翻译这首歌」才会调用你配置的模型，不会自动发起外部请求。':
    '優先使用網易雲內建的官方譯文；沒有譯文時，點歌詞頁的「翻譯這首歌」才會呼叫你設定的模型，不會自動發出外部請求。',
  翻译服务地址: '翻譯服務地址', 翻译服务密钥: '翻譯服務金鑰', 翻译模型: '翻譯模型',
  '模型名，如 gpt-4o-mini': '模型名，例如 gpt-4o-mini', 保存翻译服务: '儲存翻譯服務',
  '当前状态：未配置翻译服务，只有网易云自带译文的歌曲能显示译文':
    '目前狀態：未設定翻譯服務，只有網易雲內建譯文的歌曲能顯示譯文',
  '已保存（留空则不修改）': '已儲存（留空則不修改）',
  请填写服务地址与模型名: '請填寫服務地址與模型名', '请填写 API Key': '請填寫 API Key',
  翻译服务已保存: '翻譯服務已儲存',
  'http://127.0.0.1:7890（留空 = 不使用代理）': 'http://127.0.0.1:7890（留白 = 不使用代理）',
  网络代理地址: '網路代理地址',
  '输入音源脚本 URL（如 https://…/xxx.js）': '輸入音源腳本 URL（例如 https://…/xxx.js）',
  '音源脚本 URL': '音源腳本 URL', 'URL 需以 http(s):// 开头': 'URL 需以 http(s):// 開頭',
  清除全部最近搜索: '清除全部最近搜尋', 删除这条记录: '刪除這筆記錄', 大家都在搜: '大家都在搜'};

const EN = {
  // 导航 / 侧栏
  发现: 'Discover', 音乐馆: 'Music Hall', 搜索: 'Search', 本地音乐: 'Local Music', 我的: 'Library',
  设置: 'Settings', 声场: 'Soundstage', 快捷电台: 'Quick Radio', 治愈电台: 'Chill Radio',
  摇滚能量: 'Rock Energy', 深夜Emo: 'Late Night', 通勤回血: 'Commute Boost',
  // 标题栏 / 徽标
  离线示例: 'Offline', 在线曲库: 'Online', 未在播放: 'Not playing', 未选择歌曲: 'No track selected',
  迷你模式: 'Mini mode', 最小化: 'Minimize', 最大化: 'Maximize', 还原: 'Restore', 关闭: 'Close',
  打开正在播放: 'Open Now Playing', 回到发现: 'Back to Discover',
  // 播放控制
  播放: 'Play', 暂停: 'Pause', 上一首: 'Previous', 下一首: 'Next', 播放队列: 'Queue',
  播放全部: 'Play All', 随机播放: 'Shuffle', 加入队列: 'Add to Queue', 加入播放队列: 'Add to queue',
  清空: 'Clear', 清空队列: 'Clear Queue', 收藏: 'Favorite', 取消收藏: 'Unfavorite', 静音: 'Mute',
  取消静音: 'Unmute', 顺序播放: 'Sequential', 列表循环: 'List Loop', 单曲循环: 'Repeat One',
  从头播放: 'Play from start', 下载这首歌: 'Download this song', 下载: 'Download', 歌词: 'Lyrics',
  // 视图
  返回: 'Back', 重试: 'Retry', 继续搜索: 'Search more', 播放历史: 'History', 全部历史: 'All History',
  收藏夹: 'Favorites', 等待第一首歌: 'Waiting for the first track', 随机来一首: 'Surprise me',
  '随机来一首，点亮声场': 'Random pick to light up the soundstage', 去发现: 'Go to Discover',
  去发现音乐: 'Discover music', 去搜索: 'Go to Search', 移除: 'Remove', 删除: 'Delete',
  移出队列: 'Remove from queue', 选择文件: 'Choose File', 选择文件夹: 'Choose Folder',
  浏览音乐馆: 'Browse Music Hall', 热门搜索: 'Trending', 最近搜索: 'Recent', 清除: 'Clear',
  清空搜索: 'Clear', 全部: 'All', 华语: 'Mandarin', 欧美: 'Western', 日语: 'Japanese',
  韩语: 'Korean', 轻音乐: 'Light Music', 摇滚: 'Rock', 自定义: 'Custom',
  // 空态 / 提示
  这里还是空的: 'Nothing here yet', 还没有本地音乐: 'No local music yet', 还没有收藏: 'No favorites yet',
  还没有播放历史: 'No play history yet', 队列是空的: 'Queue is empty', 队列已经是空的: 'Queue is already empty',
  这些歌曲已在队列中: 'These tracks are already in the queue', 这里还没有可播放的歌曲: 'No playable tracks here',
  这个歌单还没有歌曲: 'This playlist has no songs', 没有找到歌单: 'No playlists found', 加载失败: 'Load failed',
  网络异常: 'Network error', 已收藏: 'Favorited', 已取消收藏: 'Removed from favorites',
  已从本地曲库移除: 'Removed from local library', 已从队列移除: 'Removed from queue',
  已加入队列: 'Added to queue', 已清空: 'Cleared', 已删除: 'Deleted', 已启用: 'Enabled', 已停用: 'Disabled',
  已导入: 'Imported', 已安装: 'Installed', 已保存到: 'Saved to', 正在导入音源: 'Importing source…',
  正在读取音源: 'Reading sources…', 正在下载: 'Downloading…', 正在播放: 'Now playing',
  点击跳转: 'Click to jump', 聚焦搜索: 'Focus search', 打开歌单: 'Open playlist',
  确定删除这个音源: 'Delete this source?', 清空全部收藏: 'Clear all favorites?', 清空播放历史: 'Clear play history?',
  先播放一首歌曲: 'Play a song first', 先选择一首歌曲: 'Select a song first',
  本地文件可直接在原位置查看: 'Local files can be viewed in place',
  '睡眠定时结束，音乐已淡出': 'Sleep timer finished, music faded out', 还没有正在播放的歌曲: 'No track playing',
  播放或暂停: 'Play or pause', 音量: 'Volume', 播放进度: 'Progress',
  // 设置
  基本设置: 'General', 播放设置: 'Playback', 播放详情页设置: 'Now Playing Page', 桌面歌词: 'Desktop Lyrics',
  列表设置: 'Lists', 下载设置: 'Downloads', 网络代理: 'Network Proxy', 自定义源管理: 'Custom Sources',
  播放与快捷键: 'Playback & Shortcuts', 关于: 'About', 音乐来源: 'Music Source', 默认音质: 'Default Quality',
  歌词页背景: 'Lyric Background', 封面模糊: 'Cover Blur', 封面主色: 'Cover Color', 应用背景: 'App Background',
  主题颜色: 'Theme Color', 信号琥珀: 'Amber', 霓虹紫: 'Violet', 电子青: 'Cyan', 玫红: 'Rose',
  窗口尺寸: 'Window Size', 字体大小: 'Font Size', 语言: 'Language', 简体中文: '简体中文',
  繁體中文: '繁體中文', 显示动画效果: 'Show Animations', 更小: 'XS', 小: 'S', 标准: 'M', 大: 'L',
  更大: 'XL', 非常大: 'XXL', 启动软件后自动播放音乐: 'Auto-play on startup',
  播放歌曲时阻止电脑休眠: 'Prevent sleep while playing', 记住播放进度: 'Remember playback progress',
  播放错误时自动切换歌曲: 'Auto-skip on playback error', 使用卡拉OK样式歌词播放: 'Karaoke-style lyrics',
  在任务栏上显示当前歌曲播放进度: 'Show progress on taskbar', 缩放当前正在播放的歌曲: 'Scale current lyric line',
  延迟歌词滚动: 'Delay lyric scrolling', 允许通过拖拽歌词调整播放进度: 'Drag lyrics to seek',
  歌词对齐方式: 'Lyric Alignment', 显示桌面歌词: 'Show desktop lyrics', 歌词字体颜色: 'Lyric Colors',
  桌面歌词对齐方式: 'Desktop Lyric Alignment', 桌面歌词加粗: 'Bold desktop lyrics',
  桌面歌词字号: 'Desktop Lyric Size', 锁定桌面歌词: 'Lock desktop lyrics',
  显示歌曲来源平台: 'Show source platform', 记住播放列表滚动位置: 'Remember list scroll position',
  双击列表里的歌曲时自动切换到当前列表播放: 'Double-click a song to switch the playing list',
  添加歌曲到播放列表的位置: 'Add position in queue', 顶部: 'Top', 底部: 'Bottom',
  启用下载功能: 'Enable downloads', 下载路径: 'Download Folder', 文件命名方式: 'File Naming',
  歌曲名: 'Title', 艺术家: 'Artist', 未播放: 'Idle', 已播放: 'Played', 阴影: 'Shadow',
  中: 'Center', 左: 'Left', 右: 'Right', 上一页: 'Previous', 下一页: 'Next',
  // 分页单位
  项: 'items', 首: 'songs', 首歌曲: 'songs', 个歌单: 'playlists',
  保存代理: 'Save Proxy', 从URL安装: 'Install from URL', 导入本地: 'Import .js',
  快捷键: 'Shortcuts', 快退: 'Rewind', 快进: 'Forward', 秒: 's', 打开歌词: 'Open lyrics',
  播放队列抽屉: 'Queue Drawer', 关闭声场: 'Close soundstage', 关闭队列: 'Close queue',
  外观: 'Appearance', 睡眠定时: 'Sleep Timer', 图形均衡器: 'Equalizer', 扁平: 'Flat',
  实时频谱: 'Live Spectrum', 播放结束淡出关闭: 'Fade out then stop',
  // Account & sign-in
  登录网易云账号: 'Sign in to NetEase Music', 匿名账号: 'Anonymous account', 已登录: 'Signed in', 未登录: 'Not signed in',
  '游客态 · 建议在 App 内登录主账号': 'Guest account · sign in with your main account in the app',
  '黑胶会员 · 已同步': 'Vinyl member · synced', '网易云用户 · 已同步': 'NetEase user · synced',
  '当前是网易云游客账号，收藏与推荐可用，但没有昵称头像': 'This is a NetEase guest account: favorites and recommendations work, but there is no nickname or avatar.',
  扫码登录网易云: 'Scan to sign in to NetEase', '曲库离线，暂无法登录': 'Library is offline, sign-in unavailable',
  '网易云接口不可达，无法登录': 'NetEase API unreachable, cannot sign in', 每日推荐: 'Daily Mix',
  我收藏的歌单: 'My playlists', 账号信息: 'Account', 退出登录: 'Sign out', 昵称: 'Nickname', 等级: 'Level',
  会员: 'Membership', 黑胶会员: 'Vinyl member', 普通用户: 'Standard user', 账号类型: 'Account type',
  '游客态（网易云未返回资料页）': 'Guest (NetEase returned no profile)',
  '这个账号是在网易云 App 里以游客态扫码的：收藏、订阅、每日推荐都可用，但昵称头像不存在。想要个性化推荐，请在 App 内登录主账号后回来重新扫码。':
    'This account was created as a guest in the NetEase app. Favorites, subscriptions and daily mixes work, but it has no nickname or avatar. For real recommendations, sign in to your main account in the app, then scan again.',
  '个性签名：': 'Bio: ',
  '登录凭证保存在本机，不会发送到界面层。': 'Credentials stay on this device and never reach the interface layer.',
  知道了: 'Got it', 已退出登录: 'Signed out', 退出失败: 'Sign-out failed',
  '二维码已过期，正在刷新…': 'QR code expired, refreshing…',
  '等待扫码 · 请用网易云音乐 App 扫二维码': 'Waiting for scan · use the NetEase Music app',
  '已扫码 · 请在手机上确认登录': 'Scanned · confirm on your phone', 登录成功: 'Signed in',
  '网易云接口不可达，暂时无法登录': 'NetEase API unreachable, sign-in unavailable',
  正在生成二维码: 'Generating QR code', '扫码并在手机上确认后自动登录；凭证仅保存在本机用户目录。':
    'Scan it and confirm on your phone. Credentials are stored only in this device’s user folder.',
  扫码登录: 'Scan to sign in', '打开网易云音乐 App → 我的 → 右上角扫码。': 'Open NetEase Music → Me → scan icon at the top right.',
  取消: 'Cancel', 未取得登录密钥: 'No login key returned', 登录二维码: 'Sign-in QR code',
  二维码生成失败: 'Could not generate QR code', 重新生成: 'Regenerate', 登录状态查询失败: 'Sign-in status check failed',
  网易云用户: 'NetEase user', 等待扫码: 'Waiting for scan',
  换主账号登录: 'Use main account', 不再提示: 'Don’t ask again',
  // Discover / hero
  声场面板: 'Soundstage', '播放/暂停': 'Play/Pause', 循环模式: 'Repeat mode',
  '把任意设备的扬声器，变成一台声场仪表盘。在线曲库 × 本地音乐 × 实时频谱。':
    'Turn any speaker into a soundstage console. Online library × local files × live spectrum.',
  '在<em>深夜</em><br>听见自己': 'Hear yourself <em>late<br>at night</em>',
  '聚合精选歌单，一键播放；打开声场面板，实时频谱、图形均衡器与睡眠定时都已就位。':
    'Curated playlists, one-click play. Open the soundstage for a live spectrum, graphic EQ and sleep timer.',
  '精选歌单 <span class="section__sub">每日更新</span>': 'Featured playlists <span class="section__sub">updated daily</span>',
  '继续聆听 <span class="section__sub">最近播放</span>': 'Keep listening <span class="section__sub">recently played</span>',
  歌单加载失败: 'Could not load playlists', 推荐新歌: 'New releases', 根据你的收听历史生成: 'Made from your listening history',
  网易云近期上新: 'Fresh on NetEase', 换一批: 'Shuffle', 登录网易云解锁属于你的每日推荐: 'Sign in to unlock your daily mix',
  '登录网易云，解锁属于你的每日推荐': 'Sign in to NetEase to unlock your daily mix',
  按风格浏览热门歌单: 'Browse popular playlists by genre', '按风格浏览热门歌单。': 'Browse popular playlists by genre.',
  '实时搜索网易云曲库：输入即搜，回车立即执行。': 'Live search over the NetEase library: type to search, Enter to run.',
  '想听点什么？歌曲 / 歌单 / 艺人': 'What shall we play? Songs / playlists / artists',
  歌曲: 'Songs', 歌单: 'Playlists', 搜索失败: 'Search failed',
  '换一个关键词，或者试试下方热门搜索。': 'Try another keyword, or one of the popular searches below.',
  '换一个关键词，或切到歌曲搜索。': 'Try another keyword, or switch to song search.',
  搜歌曲: 'Search songs',
  // Local music
  '导入的曲目登记在本机清单里，重启后依然在。': 'Imported tracks are registered on this device and survive a restart.',
  '导入本地音频，用同一套播放器与声场播放。': 'Import local audio and play it with the same player and soundstage.',
  把音频文件拖到这里: 'Drop audio files here',
  '·  支持 mp3 / flac / wav / ogg / m4a / aac': '·  mp3 / flac / wav / ogg / m4a / aac supported',
  '把 mp3 / flac 等文件拖进上方区域，或通过按钮导入。导入后即可用均衡器与频谱播放。':
    'Drag mp3 / flac files into the area above, or import with the button. Then play them with the EQ and spectrum.',
  打开文件对话框失败: 'Could not open the file dialog', 打开目录对话框失败: 'Could not open the folder dialog',
  '正在扫描目录，请稍候…': 'Scanning folder, please wait…', 扫描失败: 'Scan failed', 目录不可读: 'Folder unreadable',
  导入失败: 'Import failed', 无法读取所选文件: 'Cannot read the selected file', 没有可导入的音频文件: 'No audio files to import',
  这些曲目已经在曲库里了: 'These tracks are already in the library', 本地文件: 'Local file',
  '浏览器环境无法扫描目录，请改用文件选择': 'The browser cannot scan folders — use the file picker instead',
  // Library / queue / playlists
  历史: 'History', 队列: 'Queue', 我的歌单: 'My playlists', 订阅歌单: 'Subscribed', 云歌单: 'Cloud',
  '收藏、播放历史、当前队列、本地歌单与网易云账号歌单。': 'Favorites, history, queue, local playlists and your NetEase account playlists.',
  '登录后查看云端歌单': 'Sign in to browse cloud playlists',
  '登录网易云账号后，这里会列出你在云端创建与收藏的全部歌单，还能直接播放「我喜欢的音乐」——换设备也不会丢。': 'After signing in with NetEase, every playlist you created or saved in the cloud shows up here — including "Liked Songs", ready to play. Nothing is lost across devices.',
  '我喜欢的音乐': 'Liked Songs',
  '我喜欢的音乐 / 我创建的歌单': 'Liked Songs / Playlists I created',
  我收藏的歌单: 'Playlists I saved',
  '直接在账号歌单上播放，只读不改动云端数据': 'Plays straight from your account — read-only, nothing is modified in the cloud',
  刷新: 'Refresh',
  '正在同步云端歌单…': 'Syncing cloud playlists…',
  '云端歌单加载失败': 'Failed to load cloud playlists',
  '未取到账号 UID': 'Account UID unavailable',
  '当前登录态缺少用户资料（多为游客态）。请在网易云 App 内登录主账号后重新扫码。': 'This session has no user profile (usually a guest account). Sign in with your main account in the NetEase app, then scan again.',
  '正在读取「我喜欢的音乐」…': 'Loading Liked Songs…',
  // 登录
  '登录网易云': 'Sign in to NetEase',
  手机号: 'Phone', 邮箱: 'Email', 验证码: 'Code', 短信验证码: 'SMS code',
  获取验证码: 'Send code', 密码: 'Password', 网易云密码: 'NetEase password',
  登录: 'Sign in', '登录中…': 'Signing in…',
  '验证码已发送，请查收短信': 'Code sent — check your messages',
  '验证码由网易云发送；国内手机号默认 +86。': 'The code is sent by NetEase; mainland China numbers default to +86.',
  '使用网易云音乐主站账号密码；开启二次验证的账号建议改用扫码。': 'Use your NetEase Music account password; accounts with 2FA should scan instead.',
  '扫码最快；手机号与邮箱走网易云官方登录接口。凭证只保存在本机用户目录，界面层拿不到。': 'Scanning is fastest; phone and email use NetEase official endpoints. Credentials stay in the local user directory and never reach the UI layer.',
  // 音效
  日志目录: 'Log directory', '运行日志仅保存在本机，排查故障时提供给开发者': 'Logs are stored locally only — share them with the developer when troubleshooting.',
  音效: 'Sound FX', 空间宽度: 'Stereo width', 混响强度: 'Reverb', 恢复场景默认: 'Reset to scene defaults',
  关闭: 'Off', 录音室: 'Studio', 现场: 'Live', 耳机: 'Headphones', 夜间: 'Night',
  '空间音频与场景预设直接作用于 Web Audio 音频链，播放中即时生效；与上面的 10 段均衡器叠加使用。': 'Spatial audio and scene presets run on the Web Audio graph and apply instantly during playback, stacking on top of the 10-band EQ above.',
  '原始音频直通，不做任何染色': 'Bit-transparent passthrough, no coloration',
  '干净紧致的监听感，几乎无混响': 'Tight, clean monitoring with almost no reverb',
  '厅堂混响 + 更宽声场，像站在台下': 'Hall reverb and a wider stage — like standing front row',
  '强化低频与声场包裹感，适合入耳式': 'Boosted low end and enveloping width, tuned for in-ears',
  '收窄动态范围，深夜不炸耳': 'Tighter dynamics so late-night listening stays gentle',
  '100% 为原始立体声；调高拉宽声场，过高会显得中空。': '100% is the original stereo image; higher widens the stage, too high sounds hollow.',
  '模拟房间反射；各场景自带不同默认值，可在此微调。': 'Simulates room reflections; each scene has its own default you can fine-tune here.',
  // 多平台搜索
  网易云音乐: 'NetEase', 酷狗音乐: 'Kugou', 搜索平台: 'Search platform',
  'QQ 音乐': 'QQ Music', 网易云: 'NetEase', 酷狗: 'Kugou',
  '多平台搜索：网易云 / QQ 音乐 / 酷狗，输入即搜，回车立即执行。': 'Multi-platform search: NetEase / QQ Music / Kugou — type to search, Enter to run.',
  播放队列是空的: 'The queue is empty',
  '在曲目行悬停点击＋，或播放任意歌单来填充队列。': 'Hover a track and hit ＋, or play any playlist to fill the queue.',
  队列已清空: 'Queue cleared',
  '在播放条或任意曲目行点击 ♥，喜欢的歌会出现在这里。': 'Tap ♥ on the player bar or any track row — favourites land here.',
  '播放过的歌曲会自动记录在这里。': 'Songs you play are recorded here automatically.',
  已移除: 'Removed', 打开: 'Open', 重命名: 'Rename', 删除歌单: 'Delete playlist', 新建歌单: 'New playlist',
  歌单名称: 'Playlist name', '例如：深夜写代码': 'e.g. Late-night coding', 创建: 'Create',
  歌单名称不能为空: 'Playlist name cannot be empty', 重命名歌单: 'Rename playlist', 保存: 'Save', 已重命名: 'Renamed',
  已删除歌单: 'Playlist deleted', "新建歌单…": 'New playlist…', 这首歌已经在歌单里了: 'Already in this playlist',
  还没有本地歌单: 'No local playlists yet',
  '在任何曲目上右键 → 加入歌单，就能把散落的歌收进一个袋子里；歌单只保存在本机，重启也在。':
    'Right-click any track → Add to playlist to gather loose songs in one bag. Playlists live on this device and survive a restart.',
  新建第一个歌单: 'Create your first playlist', 歌单不存在或已删除: 'Playlist missing or deleted', 回到我的: 'Back to Library',
  这些本地曲目已不在曲库: 'These local tracks are no longer in the library', 这个歌单还是空的: 'This playlist is still empty',
  '本地文件被移动或删除后无法播放，可在「本地音乐」重新导入。':
    'Local files that were moved or deleted cannot play — re-import them under Local Music.',
  '在任意曲目行右键 → 加入歌单，把歌收进来。': 'Right-click any track row → Add to playlist.',
  去本地音乐: 'Go to Local Music', 已从歌单移除: 'Removed from playlist', 移出歌单: 'Remove from playlist',
  下一首播放: 'Play next', 加入歌单: 'Add to playlist', '加入歌单…': 'Add to playlist…',
  本机: 'This device', 自建: 'Yours', 云端: 'Cloud', 同步到网易云: 'Sync to NetEase',
  已收藏歌单: 'Playlist subscribed', 已取消收藏歌单: 'Playlist unsubscribed', 网易云端同步失败: 'NetEase sync failed',
  接口不可用: 'API unavailable', 同步失败: 'Sync failed', 请先登录网易云账号: 'Sign in to NetEase first',
  '账号信息缺少 UID，请在账号菜单里退出后重新扫码': 'Account info has no UID — sign out from the account menu and scan again',
  '正在拉取云端歌单…': 'Fetching cloud playlists…', 云端还没有歌单: 'No cloud playlists yet', 拉取失败: 'Fetch failed',
  同时取消云端: 'Also unsubscribe', 只删本机: 'Keep on cloud', 云端取消失败: 'Cloud unsubscribe failed',
  已从本机与网易云取消收藏: 'Unsubscribed on this device and on NetEase', 已从本机取消收藏: 'Removed on this device',
  导入歌单: 'Import playlist', '网易云歌单链接或 ID': 'NetEase playlist link or ID',
  '没有识别到歌单 ID': 'No playlist ID found', '正在读取歌单…': 'Reading playlist…',
  歌单不存在或无权访问: 'Playlist missing or not accessible', 歌单不存在: 'Playlist not found',
  '全部只存在本机，点「拉取云端」合并账号里的歌单': 'All stored on this device only — hit “Fetch cloud playlists” to merge your account’s lists',
  '登录后可与网易云收藏互相同步': 'Sign in to sync favourites with NetEase', 拉取云端歌单: 'Fetch cloud playlists',
  导入歌单链接: 'Import by link', 还没有收藏在线歌单: 'No subscribed playlists yet',
  '点「拉取云端歌单」把你网易云账号里的歌单一次搬进来；也可以粘贴链接或去音乐馆收藏。':
    'Hit “Fetch cloud playlists” to pull everything from your NetEase account, paste a link, or subscribe in Music Hall.',
  '在歌单详情页点「收藏歌单」，或粘贴网易云歌单链接导入。登录后可以与网易云互相同步。':
    'Tap “Subscribe” on a playlist page, or paste a NetEase link. Once signed in, subscriptions sync both ways.',
  登录网易云: 'Sign in to NetEase', 去音乐馆: 'Go to Music Hall', 收藏歌单: 'Subscribe', 试试其他歌单: 'Try another playlist.',
  已在播放队列中: 'Already in the queue', 暂无可播放内容: 'Nothing to play', 随机播放失败: 'Shuffle failed',
  播放列表已结束: 'End of list', 已淡出并暂停: 'Faded out and paused',
  // Lyrics / player
  '专辑 · {album}': 'Album · {album}', 本地音乐暂无歌词: 'No lyrics for local files',
  '暂无歌词 · 请欣赏旋律': 'No lyrics · enjoy the music', 上下拖拽调整播放进度: 'Drag up or down to seek',
  '播放歌曲或点击曲目行的＋加入队列。': 'Play a song, or hit ＋ on a track row to queue it.',
  '随机播放：开': 'Shuffle: on', '随机播放：关': 'Shuffle: off', 播放队列为空: 'Queue is empty',
  随机播放已开启: 'Shuffle on', 随机播放已关闭: 'Shuffle off',
  '下载功能已在设置 → 下载设置中关闭': 'Downloads are off — enable them in Settings → Downloads',
  无法获取该歌曲的下载地址: 'No download URL for this track', '下载失败（HTTP': 'Download failed (HTTP',
  已连接网易云曲库: 'Connected to the NetEase library',
  '网易云接口暂不可达，使用内置示例曲库': 'NetEase API unreachable — using the built-in sample library',
  '孤男音乐 · 桌面声场': 'Lonely Guy Music · Desktop Soundstage', 解锁: 'Unlock', '锁定（鼠标穿透）': 'Lock (click-through)',
  '音源与官方接口均无可用地址（可能无版权或已下架）': 'No URL from any source or the official API (unlicensed or removed)',
  播放被浏览器拦截: 'Playback blocked by the browser',
  '音频地址无效或格式不支持（音源可能已失效）': 'Invalid or unsupported audio URL (the source may be dead)',
  '网络中断，请稍后重试': 'Network interrupted, try again shortly', 音频解码失败: 'Audio decode failed',
  被浏览器拦截: 'Blocked by the browser', 'FLAC 无损': 'FLAC lossless', 超大: 'Huge',
  '歌曲名 - 艺术家': 'Title - Artist', '艺术家 - 歌曲名': 'Artist - Title',
  空格: 'Space', '播放 / 暂停': 'Play / pause', '快退 / 快进 5 秒': 'Rewind / forward 5s', '音量 ±5%': 'Volume ±5%',
  关闭浮层: 'Close overlay', 减小字号: 'Smaller text', 增大字号: 'Larger text', 关闭桌面歌词: 'Close desktop lyrics',
  当前: 'Current', 更改: 'Change', 确定: 'OK', 输入: 'Input', 对话框: 'Dialog', 确认操作: 'Confirm',
  '换个分类或关键词试试。': 'Try another category or keyword.',
  // Settings copy
  '播放、外观、歌词、列表与下载，全部选项即时生效。': 'Playback, appearance, lyrics, lists and downloads — every option applies instantly.',
  '动画、主题、窗口与字体，随时切换即时生效。': 'Animation, theme, window and type — switch any time, applies instantly.',
  "关闭后减少界面动效，低性能设备更流畅": 'Reduces motion for smoother performance on slow devices',
  "全站强调色，影响按钮、频谱、氛围光": 'Site-wide accent colour: buttons, spectrum and ambient light',
  "切换后整个界面立即转换，可随时切回": 'The whole interface switches at once, and can be reverted any time',
  '搜索使用网易云元数据，播放时优先调用下方已启用的自定义音源获取真实链接；失败会自动降级到官方接口。':
    'Search uses NetEase metadata. Playback prefers the enabled custom sources below, falling back to the official API.',
  启动时自动接着播放上次的歌曲: 'Resume the last track automatically on launch',
  播放期间系统不会进入睡眠: 'Keep the system awake while playing',
  再次播放同一首歌时恢复到上次位置: 'Restore the last position when a track plays again',
  取链或播放失败时自动播放下一首: 'Skip to the next track when linking or playback fails',
  已播放的歌词逐字高亮: 'Highlight played lyrics word by word',
  'Windows 任务栏图标显示播放进度': 'Show playback progress on the Windows taskbar icon',
  点击播放条封面打开的歌词大页: 'The full-screen lyrics page opened from the player bar cover',
  '当前歌词行放大，其余行淡出': 'Enlarge the current line, fade the rest',
  '歌词稍晚跟随播放进度，适合跟唱': 'Lyrics follow the playhead slightly later — good for singing along',
  '上下拖拽歌词行快进/快退': 'Drag lyric lines up or down to seek',
  '在桌面上显示一层置顶歌词，可锁定位置。': 'A pinned lyrics layer on your desktop, position lockable.',
  在屏幕底部显示置顶歌词窗口: 'Show a always-on-top lyrics window at the bottom of the screen',
  '未播放 / 已播放 / 阴影颜色': 'Unplayed / played / shadow colour',
  '锁定后鼠标事件穿透，不会挡住桌面操作': 'When locked, clicks pass through to the desktop',
  在曲目名后标注来源平台: 'Tag each track with its source platform',
  返回列表时恢复上次浏览位置: 'Restore your scroll position when returning to a list',
  双击直接用当前列表替换播放队列: 'Double-click replaces the queue with the current list',
  '把在线歌曲保存到本地，文件名按下方规则生成。': 'Save online tracks locally; file names follow the rule below.',
  在曲目行与歌词页显示下载按钮: 'Show the download button on track rows and the lyrics page',
  留空则每次下载时询问保存位置: 'Leave empty to be asked where to save each time',
  "未设置（每次询问）": 'Not set (ask each time)', 已恢复每次询问: 'Asked each time again', 恢复询问: 'Ask each time',
  '音源的网络请求默认直连，不读取系统代理。仅当你的网络必须通过代理才能访问音源接口时，才需要填写；保存后立即生效，无需重启。':
    'Source requests go direct by default and ignore the system proxy. Fill this only if your network needs a proxy to reach them; applies on save, no restart.',
  '兼容 LX Music 自定义音源脚本。导入后启用，播放时会优先用音源取链；全部失败才降级官方接口。':
    'Compatible with LX Music source scripts. Once enabled, sources resolve URLs first; the official API is the fallback.', '导入本地 .js': 'Import local .js',
  '正在读取音源…': 'Reading source…', '支持系统媒体键与托盘控制。以下快捷键在非输入状态下生效。':
    'System media keys and tray controls supported. The shortcuts below apply when you are not typing.',
  '在线曲库（网易云）': 'Online library (NetEase)', 离线示例曲库: 'Offline sample library',
  '在线曲库依赖第三方接口，仅供学习研究；本地音乐与自定义音源均在本机处理。':
    'The online library relies on a third-party API, for study only. Local files and custom sources stay on this device.',
  音源列表加载失败: 'Could not load sources', 暂无自定义音源: 'No custom sources',
  '导入本地 .js 或从 URL 安装音源脚本。未安装时仍可使用官方接口或离线示例。':
    'Import a local .js or install from URL. Without one, the official API or offline samples still work.',
  初始化失败: 'Init failed', 设置音质失败: 'Could not set quality', 当前环境不支持选择目录: 'This environment cannot pick folders',
  下载路径已设置: 'Download path set', 选择目录失败: 'Could not choose folder',
  当前状态未使用代理音源请求直连: 'Current: no proxy, source requests go direct',
  '当前状态：未使用代理，音源请求直连': 'Current: no proxy, source requests go direct',
  "已关闭代理（恢复直连）": 'Proxy off (direct again)', 保存失败: 'Save failed', 音源脚本: 'Source script',
  '正在导入音源…': 'Importing source…', 请输入音源脚本: 'Enter a source script URL',
  '请输入音源脚本 URL': 'Enter a source script URL', '正在下载…': 'Downloading…', 安装失败: 'Install failed',
  音源已启用: 'Source enabled', 音源已停用: 'Source disabled', 切换失败: 'Toggle failed', '确定删除这个音源？': 'Delete this source?', 删除失败: 'Delete failed',
  双击替换播放队列: 'Double-click replaces queue', 启用下载: 'Enable downloads',
  // Punctuation-qualified toast variants (tr matches whole trimmed strings, so they need their own keys)
  '退出失败：': 'Sign-out failed: ', '正在生成二维码…': 'Generating QR code…', '已登录：': 'Signed in: ',
  '等待扫码…': 'Waiting for scan…', 未命名歌单: 'Untitled playlist', 未知艺人: 'Unknown artist',
  未知曲目: 'Unknown track', 当前是网易云游客账号: 'This is a NetEase guest account',
  '收藏、订阅、播放记录都能正常用，但网易云没有给这个账号昵称和头像，个性化推荐也基本是空的。':
    'Favourites, subscriptions and history all work, but NetEase gave this account no nickname or avatar, so the recommendations stay generic.',
  '请在手机网易云 App 里确认已登录主账号，再回来重新扫码。':
    'Confirm your main account is signed in on the NetEase app on your phone, then scan again.',
  '打开文件对话框失败：': 'File dialog failed: ', '打开目录对话框失败：': 'Folder dialog failed: ',
  '扫描失败：': 'Scan failed: ', '导入失败：': 'Import failed: ', '网易云端同步失败：': 'NetEase sync failed: ',
  '同步失败：': 'Sync failed: ', '拉取失败：': 'Fetch failed: ', '云端取消失败：': 'Cloud unsubscribe failed: ',
  '随机播放失败：': 'Shuffle failed: ', '下载失败：': 'Download failed: ', '设置音质失败：': 'Could not set quality: ',
  '选择目录失败：': 'Could not choose folder: ', '保存失败：': 'Save failed: ', '安装失败：': 'Install failed: ',
  '切换失败：': 'Toggle failed: ', '删除失败：': 'Delete failed: ',
  '点击播放条封面打开的歌词大页。': 'The full lyrics page opened from the player-bar cover.',
  '从 URL 安装': 'Install from URL', '试试其他歌单。': 'Try another playlist.', 本地: 'Local', 网易云: 'NetEase',
  网易: 'NetEase',
  歌词翻译: 'Lyric Translation', 只看原文: 'Original only', 只看译文: 'Translation only',
  双语对照: 'Bilingual', 歌词显示: 'Lyric display', 翻译这首歌: 'Translate this song',
  '正在翻译…': 'Translating…', 译文已就绪: 'Translation ready',
  '翻译失败，点此重试': 'Translation failed — click to retry',
  '未配置翻译服务或翻译失败': 'No translation service configured, or the request failed',
  翻译失败: 'Translation failed',
  '译文按界面语言生成：简体/繁体界面译成中文，英文界面译成英文':
    'Translations follow the interface language: Chinese for Simplified/Traditional UI, English for the English UI',
  '优先使用网易云自带的官方译文；没有译文时，点歌词页的「翻译这首歌」才会调用你配置的模型，不会自动发起外部请求。':
    'Official NetEase translations are used first. Only when a song has none will “Translate this song” call your own model — no external request happens on its own.',
  翻译服务地址: 'Translation service URL', 翻译服务密钥: 'Translation API key', 翻译模型: 'Translation model',
  '模型名，如 gpt-4o-mini': 'Model name, e.g. gpt-4o-mini', 保存翻译服务: 'Save translation service',
  '当前状态：未配置翻译服务，只有网易云自带译文的歌曲能显示译文':
    'Status: no translation service configured — only songs with a built-in NetEase translation can show one',
  '已保存（留空则不修改）': 'Saved (leave blank to keep)',
  请填写服务地址与模型名: 'Please fill in the service URL and model name',
  '请填写 API Key': 'Please enter an API key',
  翻译服务已保存: 'Translation service saved',
  'http://127.0.0.1:7890（留空 = 不使用代理）': 'http://127.0.0.1:7890 (blank = no proxy)',
  网络代理地址: 'Proxy address',
  '输入音源脚本 URL（如 https://…/xxx.js）': 'Enter a source script URL (e.g. https://…/xxx.js)',
  '音源脚本 URL': 'Source script URL', 'URL 需以 http(s):// 开头': 'URL must start with http(s)://',
  清除全部最近搜索: 'Clear all recent searches', 删除这条记录: 'Delete this entry',
  大家都在搜: 'Trending searches'};

const DICTS = { 'zh-TW': ZH_TW, en: EN };

/* ---------- 动态句子模板（含占位符） ---------- */
// 每条：{ re: 简体正则, make: (match, dict) => 译文 }
const PATTERNS = [
  {
    re: /^孤男音乐 · 桌面声场 (v\S+) · 当前模式：(.+)。$/,
    make: (m) => {
      const online = m[2].startsWith('在线曲库');
      return {
        'zh-TW': `孤男音樂 · 桌面聲場 ${m[1]} · 目前模式：${online ? '線上曲庫（網易雲）' : '離線示例曲庫'}。`,
        en: `Lonely Guy Music · Desktop Soundstage ${m[1]} · Mode: ${online ? 'NetEase online library' : 'offline sample library'}`,
      }[lang] || m[0];
    },
  },
  {
    re: /^当前状态：已配置 (.+?)（密钥只保存在本机用户目录，不会下发到界面）$/,
    make: (m) => ({
      'zh-TW': `目前狀態：已設定 ${m[1]}（金鑰只存放在本機使用者目錄，不會下發到介面）`,
      en: `Status: ${m[1]} configured (the key stays in your local user folder and is never sent to the interface)`,
    }[lang] || m[0]),
  },
  {
    re: /^找到 <b>(\d+)<\/b> 首与「(.+)」相关的歌曲$/,
    make: (m, d) => ({ 'zh-TW': `找到 <b>${m[1]}</b> 首與「${m[2]}」相關的歌曲`, en: `Found <b>${m[1]}</b> songs for “${m[2]}”` }[lang] || m[0]),
  },
  {
    re: /^找到 <b>(\d+)<\/b> 个与「(.+)」相关的歌单$/,
    make: (m) => ({ 'zh-TW': `找到 <b>${m[1]}</b> 個與「${m[2]}」相關的歌單`, en: `Found <b>${m[1]}</b> playlists for “${m[2]}”` }[lang] || m[0]),
  },
  {
    re: /^共 (\d+) 首$/,
    make: (m) => ({ 'zh-TW': `共 ${m[1]} 首`, en: `${m[1]} songs` }[lang] || m[0]),
  },
  {
    re: /^本地曲库 <b>(\d+)<\/b> 首 · 仅本次会话有效$/,
    make: (m) => ({ 'zh-TW': `本地曲庫 <b>${m[1]}</b> 首 · 僅本次工作階段有效`, en: `Local library: <b>${m[1]}</b> songs · this session only` }[lang] || m[0]),
  },
  {
    re: /^(收藏|历史)共 <b>(\d+)<\/b> 首$/,
    make: (m) => ({ 'zh-TW': `${m[1] === '收藏' ? '收藏' : '歷史'}共 <b>${m[2]}</b> 首`, en: `<b>${m[2]}</b> ${m[1] === '收藏' ? 'favorites' : 'history items'}` }[lang] || m[0]),
  },
  {
    re: /^队列共 <b>(\d+)<\/b> 首$/,
    make: (m) => ({ 'zh-TW': `佇列共 <b>${m[1]}</b> 首`, en: `Queue: <b>${m[1]}</b> songs` }[lang] || m[0]),
  },
  {
    re: /^第 (\d+) \/ (\d+) 页$/,
    make: (m) => ({ 'zh-TW': `第 ${m[1]} / ${m[2]} 頁`, en: `Page ${m[1]} of ${m[2]}` }[lang] || m[0]),
  },
  {
    re: /^共 (\d+) (.+?) · 第 (\d+) \/ (\d+) 页$/,
    make: (m) => ({ 'zh-TW': `共 ${m[1]} ${m[2]} · 第 ${m[3]} / ${m[4]} 頁`, en: `${m[1]} ${m[2]} · Page ${m[3]} of ${m[4]}` }[lang] || m[0]),
  },
  {
    re: /^共 (\d+) (.+?)$/,
    make: (m) => ({ 'zh-TW': `共 ${m[1]} ${m[2]}`, en: `${m[1]} ${m[2]}` }[lang] || m[0]),
  },
  {
    re: /^已加入队列：(.+)$/,
    make: (m) => ({ 'zh-TW': `已加入佇列：${m[1]}`, en: `Added to queue: ${m[1]}` }[lang] || m[0]),
  },
  {
    re: /^已加入队列 (\d+) 首$/,
    make: (m) => ({ 'zh-TW': `已加入佇列 ${m[1]} 首`, en: `${m[1]} tracks added to queue` }[lang] || m[0]),
  },
  {
    re: /^已导入(\d+)首本地音乐$/,
    make: (m) => ({ 'zh-TW': `已匯入 ${m[1]} 首本地音樂`, en: `${m[1]} local tracks imported` }[lang] || m[0]),
  },
  {
    re: /^已导入「(.+)」$/,
    make: (m) => ({ 'zh-TW': `已匯入「${m[1]}」`, en: `Imported “${m[1]}”` }[lang] || m[0]),
  },
  {
    re: /^已安装「(.+)」$/,
    make: (m) => ({ 'zh-TW': `已安裝「${m[1]}」`, en: `Installed “${m[1]}”` }[lang] || m[0]),
  },
  {
    re: /^已保存到：(.+)$/,
    make: (m) => ({ 'zh-TW': `已儲存到：${m[1]}`, en: `Saved to: ${m[1]}` }[lang] || m[0]),
  },
  {
    re: /^正在搜索「(.+)」…$/,
    make: (m) => ({ 'zh-TW': `正在搜尋「${m[1]}」…`, en: `Searching “${m[1]}”…` }[lang] || m[0]),
  },
  {
    re: /^正在准备下载《(.+)》…$/,
    make: (m) => ({ 'zh-TW': `正在準備下載《${m[1]}》…`, en: `Preparing download of “${m[1]}”…` }[lang] || m[0]),
  },
  {
    re: /^正在打开「(.+)」电台…$/,
    make: (m) => ({ 'zh-TW': `正在開啟「${m[1]}」電臺…`, en: `Opening “${m[1]}” radio…` }[lang] || m[0]),
  },
  {
    re: /^没有找到「(.+)」$/,
    make: (m) => ({ 'zh-TW': `沒有找到「${m[1]}」`, en: `No results for “${m[1]}”` }[lang] || m[0]),
  },
  {
    re: /^没有找到「(.+)」相关歌单$/,
    make: (m) => ({ 'zh-TW': `沒有找到「${m[1]}」相關歌單`, en: `No playlists for “${m[1]}”` }[lang] || m[0]),
  },
  {
    re: /^打开歌单 (.+)$/,
    make: (m) => ({ 'zh-TW': `開啟歌單 ${m[1]}`, en: `Open playlist ${m[1]}` }[lang] || m[0]),
  },
  {
    re: /^启用 (.+)$/,
    make: (m) => ({ 'zh-TW': `啟用 ${m[1]}`, en: `Enable ${m[1]}` }[lang] || m[0]),
  },
  {
    re: /^专辑 · (.+)$/,
    make: (m) => ({ 'zh-TW': `專輯 · ${m[1]}`, en: `Album · ${m[1]}` }[lang] || m[0]),
  },
  {
    re: /^默认音质已设为 (.+)$/,
    make: (m) => ({ 'zh-TW': `預設音質已設為 ${m[1]}`, en: `Default quality set to ${m[1]}` }[lang] || m[0]),
  },
  {
    re: /^歌词背景已设为 (.+)$/,
    make: (m) => ({ 'zh-TW': `歌詞背景已設為 ${m[1]}`, en: `Lyric background set to ${m[1]}` }[lang] || m[0]),
  },
  {
    re: /^主题已切换为(.+)$/,
    make: (m) => ({ 'zh-TW': `主題已切換為${m[1]}`, en: `Theme switched to ${m[1]}` }[lang] || m[0]),
  },
  {
    re: /^当前 (\d+) px$/,
    make: (m) => ({ 'zh-TW': `目前 ${m[1]} px`, en: `${m[1]} px` }[lang] || m[0]),
  },
  {
    re: /^当前状态：已启用代理 (.+)（音源网络请求将经过该代理）$/,
    make: (m) => ({ 'zh-TW': `目前狀態：已啟用代理 ${m[1]}（音源網路請求將經過該代理）`, en: `Status: proxy enabled ${m[1]} (source requests go through it)` }[lang] || m[0]),
  },
  {
    re: /^当前状态：未使用代理，音源请求直连$/,
    make: (m) => ({ 'zh-TW': '目前狀態：未使用代理，音源請求直連', en: 'Status: no proxy, sources connect directly' }[lang] || m[0]),
  },
  {
    re: /^已启用代理：(.+)$/,
    make: (m) => ({ 'zh-TW': `已啟用代理：${m[1]}`, en: `Proxy enabled: ${m[1]}` }[lang] || m[0]),
  },
  {
    re: /^已关闭代理（恢复直连）$/,
    make: (m) => ({ 'zh-TW': '已關閉代理（恢復直連）', en: 'Proxy disabled (direct connection)' }[lang] || m[0]),
  },
  {
    re: /^还剩 (.+) · 到点淡出并暂停$/,
    make: (m) => ({ 'zh-TW': `還剩 ${m[1]} · 到點淡出並暫停`, en: `${m[1]} left · fade out and pause` }[lang] || m[0]),
  },
  {
    re: /^随机播放 · (.+)$/,
    make: (m) => ({ 'zh-TW': `隨機播放 · ${m[1]}`, en: `Shuffle · ${m[1]}` }[lang] || m[0]),
  },
  {
    re: /^下载失败（HTTP (.+)）$/,
    make: (m) => ({ 'zh-TW': `下載失敗（HTTP ${m[1]}）`, en: `Download failed (HTTP ${m[1]})` }[lang] || m[0]),
  },
  {
    re: /^《(.+)》暂无可播放源(：.*)?$/,
    make: (m) => ({ 'zh-TW': `《${m[1]}》暫無可播放源${m[2] || ''}`, en: `No playable source for “${m[1]}”${m[2] ? ':' + m[2].slice(1) : ''}` }[lang] || m[0]),
  },
  {
    re: /^《(.+)》播放失败：(.+)$/,
    make: (m) => ({ 'zh-TW': `《${m[1]}》播放失敗：${m[2]}`, en: `Playback failed for “${m[1]}”: ${m[2]}` }[lang] || m[0]),
  },
  {
    re: /^《(.+)》音频加载失败（链接可能已失效），试试下一首$/,
    make: (m) => ({ 'zh-TW': `《${m[1]}》音訊載入失敗（連結可能已失效），試試下一首`, en: `“${m[1]}” failed to load (link may be dead), try the next one` }[lang] || m[0]),
  },
  {
    re: /^(.+)已(开启|关闭)$/,
    make: (m) => ({ 'zh-TW': `${m[1]}已${m[2] === '开启' ? '開啟' : '關閉'}`, en: `${m[1]} ${m[2] === '开启' ? 'enabled' : 'disabled'}` }[lang] || m[0]),
  },
  {
    re: /^(.+)播放失败：(.+)$/,
    make: (m) => ({ 'zh-TW': `${m[1]}播放失敗：${m[2]}`, en: `${m[1]} playback failed: ${m[2]}` }[lang] || m[0]),
  },
];

/* ---------- 翻译入口 ---------- */
export function tr(text) {
  if (lang === 'zh-CN' || typeof text !== 'string' || !text) return text;
  const dict = DICTS[lang];
  const trimmed = text.trim();
  if (dict && dict[trimmed]) return text.replace(trimmed, dict[trimmed]);
  for (const p of PATTERNS) {
    const m = trimmed.match(p.re);
    if (m) return p.make(m, dict);
  }
  return text;
}

/* ---------- 模板节点（含 HTML 的动态句子） ---------- */
// 用法：tpl(node, '找到 <b>{n}</b> 首与「{q}」相关的歌曲', { n: 40, q: '稻香' })
export function tpl(node, template, params = {}) {
  if (!node) return;
  node.dataset.i18nTpl = template;
  node.dataset.i18nParams = JSON.stringify(params);
  renderTpl(node);
}
export function renderTpl(node) {
  if (!node || !node.dataset.i18nTpl) return;
  let params = {};
  try { params = JSON.parse(node.dataset.i18nParams || '{}'); } catch (_) { /* ignore */ }
  let out = node.dataset.i18nTpl;
  for (const [k, v] of Object.entries(params)) out = out.replaceAll(`{${k}}`, String(v));
  node.innerHTML = tr(out);
}

/* ---------- 应用语言 ---------- */
const originals = new WeakMap();

function translateTextNode(node) {
  const raw = node.nodeValue;
  if (!raw || !raw.trim()) return;
  if (lang === 'zh-CN') {
    if (originals.has(node)) node.nodeValue = originals.get(node);
    return;
  }
  if (!originals.has(node)) originals.set(node, raw);
  const dict = DICTS[lang];
  const trimmed = raw.trim();
  if (dict && dict[trimmed]) {
    node.nodeValue = raw.replace(trimmed, dict[trimmed]);
    return;
  }
  for (const p of PATTERNS) {
    const m = trimmed.match(p.re);
    if (m) { node.nodeValue = p.make(m, dict); return; }
  }
}

const ATTRS = ['title', 'aria-label', 'placeholder', 'alt'];
// 属性没有像文本节点那样的"原文"留在 DOM 里，切回简体时必须靠这里记录的原文还原
const attrState = new WeakMap();

function translateAttr(elm, attr, dict) {
  const cur = elm.getAttribute?.(attr);
  if (cur == null || !cur.trim()) return;
  let s = attrState.get(elm);
  if (!s) { s = {}; attrState.set(elm, s); }
  const rec = s[attr];
  if (lang === 'zh-CN') {
    if (rec && cur === rec.out) elm.setAttribute(attr, rec.orig);
    return;
  }
  // cur 既不是原文也不是我们写进去的译文 → 业务代码改过这个属性，以新值为准
  const orig = !rec || (cur !== rec.out && cur !== rec.orig) ? cur : rec.orig;
  const trimmed = orig.trim();
  const out = dict[trimmed] ? orig.replace(trimmed, dict[trimmed]) : orig;
  s[attr] = { orig, out };
  if (out !== cur) elm.setAttribute(attr, out);
}

export function applyLang(next) {
  lang = next || 'zh-CN';
  document.documentElement.setAttribute('lang', lang === 'en' ? 'en' : lang === 'zh-TW' ? 'zh-Hant' : 'zh-CN');
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach(translateTextNode);
  // 属性
  const dict = DICTS[lang] || {};
  document.querySelectorAll('*').forEach((elm) => {
    ATTRS.forEach((attr) => translateAttr(elm, attr, dict));
  });
  // 模板节点
  document.querySelectorAll('[data-i18n-tpl]').forEach(renderTpl);
  // 标题
  document.title = tr(document.title);
}

export function currentLang() { return lang; }
