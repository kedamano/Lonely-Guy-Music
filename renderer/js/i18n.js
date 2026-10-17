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
  保存代理: '儲存代理', 从URL安装: '從URL安裝', 导入本地: '匯入本地', 重试: '重試',
  快捷键: '快速鍵', 快退: '快退', 快进: '快進', 秒: '秒', 打开歌词: '開啟歌詞',
  播放队列抽屉: '播放佇列抽屜', 清空: '清空', 关闭声场: '關閉聲場', 关闭队列: '關閉佇列',
  外观: '外觀', 睡眠定时: '睡眠定時', 图形均衡器: '圖形等化器', 扁平: '扁平', 实时频谱: '即時頻譜',
  播放结束淡出关闭: '播放結束淡出關閉', 信号琥珀: '訊號琥珀',
};

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
  保存代理: 'Save Proxy', 从URL安装: 'Install from URL', 导入本地: 'Import .js', 重试: 'Retry',
  快捷键: 'Shortcuts', 快退: 'Rewind', 快进: 'Forward', 秒: 's', 打开歌词: 'Open lyrics',
  播放队列抽屉: 'Queue Drawer', 清空: 'Clear', 关闭声场: 'Close soundstage', 关闭队列: 'Close queue',
  外观: 'Appearance', 睡眠定时: 'Sleep Timer', 图形均衡器: 'Equalizer', 扁平: 'Flat',
  实时频谱: 'Live Spectrum', 播放结束淡出关闭: 'Fade out then stop', 信号琥珀: 'Amber',
};

const DICTS = { 'zh-TW': ZH_TW, en: EN };

/* ---------- 动态句子模板（含占位符） ---------- */
// 每条：{ re: 简体正则, make: (match, dict) => 译文 }
const PATTERNS = [
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

export function applyLang(next) {
  lang = next || 'zh-CN';
  document.documentElement.setAttribute('lang', lang === 'en' ? 'en' : lang === 'zh-TW' ? 'zh-Hant' : 'zh-CN');
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach(translateTextNode);
  // 属性
  document.querySelectorAll('*').forEach((elm) => {
    ATTRS.forEach((attr) => {
      const v = elm.getAttribute?.(attr);
      if (!v || !v.trim()) return;
      if (lang === 'zh-CN') return; // 属性原文保留在 HTML/JS 中，无需还原
      const dict = DICTS[lang];
      const trimmed = v.trim();
      if (dict && dict[trimmed]) elm.setAttribute(attr, v.replace(trimmed, dict[trimmed]));
    });
  });
  // 模板节点
  document.querySelectorAll('[data-i18n-tpl]').forEach(renderTpl);
  // 标题
  document.title = tr(document.title);
}

export function currentLang() { return lang; }
