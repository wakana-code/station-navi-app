import { Ionicons } from '@expo/vector-icons';
import { ResizeMode, Video } from 'expo-av';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { DeviceMotion } from 'expo-sensors';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

// --- 1. 定数・言語設定 ---
const TRANSLATIONS: any = {
  ja: {
    appName: '駅ナビ！',
    home: 'ホーム', search: '検索', post: '投稿',
    catchphrase: '通勤時間に\nちょっと人助け',
    todaysShops: '今日のおすすめのお店',
    history: '最近見た履歴',
    language: '言語',
    postBtn: '撮影を開始する',
    postNoticeTitle: '⚠️ 撮影の注意事項',
    postNotice: '• 手ブレ補正ON推奨\n• ホームの時計・案内板を映す\n• 出口は外に出て振り返る',
    searchTypes: {
      transfer: '乗り換えの仕方', exit: '出口への行き方',
      stationShop: '駅内店舗に行く', shopFromStation: '駅から店舗まで'
    },
    tags: {
      wheelchair: '車椅子対応', elderly: '高齢者向け', baby: 'ベビーカー向け', shortest: '最短距離'
    },
    labels: {
      station: '駅名', fromLine: '出発路線', toLine: '到着路線',
      exit: '出口番号', shopAddr: '店舗住所', tags: 'タグ選択'
    }
  },
  en: {
    appName: 'Station Navi!',
    home: 'Home', search: 'Search', post: 'Post',
    catchphrase: 'Help others\nduring commute',
    todaysShops: "Recommended Shops",
    history: 'History',
    language: 'Language',
    postBtn: 'Start Recording',
    postNoticeTitle: '⚠️ Recording Rules',
    postNotice: '• Enable stabilization\n• Film clocks/signs\n• Film station from outside for exits',
    searchTypes: {
      transfer: 'Transfer', exit: 'To Exit',
      stationShop: 'Shop (Inside)', shopFromStation: 'Shop (Outside)'
    },
    tags: {
      wheelchair: 'Wheelchair', elderly: 'Elderly', baby: 'Stroller', shortest: 'Shortest'
    },
    labels: {
      station: 'Station', fromLine: 'From Line', toLine: 'To Line',
      exit: 'Exit No.', shopAddr: 'Shop Address', tags: 'Select Tags'
    }
  }
};

// --- 2. スコア計算エンジン ---
const calculateTotalScore = (video: any, userSelectedTags: string[]) => {
  const surveys = video.surveys || [];
  const now = Date.now();
  
  const recentSurveys = surveys.filter((s:any) => (now - s.timestamp) < 30 * 24 * 60 * 60 * 1000);
  let validityScore = 0;
  
  if (recentSurveys.length > 0) {
    const validCount = recentSurveys.filter((s:any) => s.stillValid).length;
    const validRatio = validCount / recentSurveys.length;
    validityScore = validRatio * 100;
    if (recentSurveys.filter((s:any) => !s.stillValid).length >= 3) {
      validityScore = 0;
    }
  }

  if (recentSurveys.length < 5) {
    const daysSinceUpload = (now - video.uploadDate) / (24 * 60 * 60 * 1000);
    validityScore = Math.max(0, validityScore - (daysSinceUpload * 2));
    if (daysSinceUpload < 30) validityScore += 20; 
  }
  validityScore = Math.min(100, validityScore);

  let watchScore = 0;
  if (surveys.length > 0) {
    const avg = surveys.reduce((acc:number, s:any) => acc + s.watchability, 0) / surveys.length;
    watchScore = (avg - 1) * 10;
  }

  let satScore = 0;
  if (surveys.length > 0) {
    const avg = surveys.reduce((acc:number, s:any) => acc + s.routeSatisfaction, 0) / surveys.length;
    satScore = (avg - 1) * 15;
  }

  let tagScore = 0;
  let matchedTagsCount = 0;

  if (video.tags.includes('wheelchair') && userSelectedTags.includes('wheelchair')) {
    const targets = surveys.filter((s:any) => s.wheelchairSuitable !== undefined);
    if (targets.length > 0) {
      const avg = targets.reduce((acc:number, s:any) => acc + s.wheelchairSuitable, 0) / targets.length;
      tagScore += (avg - 1) * 10;
      matchedTagsCount++;
    }
  }
  if (video.tags.includes('elderly') && userSelectedTags.includes('elderly')) {
    const targets = surveys.filter((s:any) => s.physicallyEasy !== undefined);
    if (targets.length > 0) {
      const avg = targets.reduce((acc:number, s:any) => acc + s.physicallyEasy, 0) / targets.length;
      tagScore += (avg - 1) * 10;
      matchedTagsCount++;
    }
  }
  const finalTagScore = matchedTagsCount > 0 ? Math.min(40, tagScore / matchedTagsCount) : 0;

  const daysSince = (now - video.uploadDate) / (24 * 60 * 60 * 1000);
  let freshnessBonus = Math.max(0, 30 * Math.exp(-daysSince / 60));
  if (validityScore > 80) {
    freshnessBonus = Math.max(0, 30 * Math.exp(-daysSince / 120));
  }

  const viewBonus = Math.min(10, Math.log10(video.views + 1) * 3);

  return validityScore + watchScore + satScore + finalTagScore + freshnessBonus + viewBonus;
};

// --- 3. メインアプリ ---
export default function App() {
  const [screen, setScreen] = useState('home');
  const [lang, setLang] = useState('ja');
  const [videos, setVideos] = useState<any[]>([]); 
  const [history, setHistory] = useState<any[]>([]);
  const t = TRANSLATIONS[lang];

  const renderScreen = () => {
    switch(screen) {
      case 'home': return <HomeScreen t={t} lang={lang} history={history} setScreen={setScreen} />;
      case 'search': return <SearchScreen t={t} lang={lang} videos={videos} setVideos={setVideos} setHistory={setHistory} />;
      case 'post': return <PostScreen t={t} lang={lang} setScreen={setScreen} setVideos={setVideos} />;
      default: return null;
    }
  };

  return (
    <View style={styles.container}>
      {renderScreen()}
      <View style={styles.bottomNav}>
        {['home', 'search', 'post'].map((key: any) => (
          <TouchableOpacity key={key} onPress={() => setScreen(key)} style={styles.navItem}>
             <Ionicons 
               name={key === 'home' ? 'home' : key === 'search' ? 'search' : 'add-circle'} 
               size={24} color={screen === key ? '#007AFF' : '#999'} 
             />
             <Text style={{color: screen === key ? '#007AFF' : '#999', fontSize: 10}}>{t[key]}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

// --- 4. ホーム画面 ---
const HomeScreen = ({ t, lang, history, setScreen }: any) => {
  const [modalVisible, setModalVisible] = useState(false);

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.logo}>駅ナビ！</Text>
        <TouchableOpacity onPress={() => setModalVisible(true)} style={styles.langBtn}>
          <Text>{lang === 'ja' ? '🇯🇵' : '🇺🇸'}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{paddingBottom: 100}}>
        <View style={styles.hero}>
          <Text style={styles.heroText}>{t.catchphrase}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.h2}>{t.todaysShops}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
             {[1,2,3].map(i => (
               <View key={i} style={styles.shopCard}>
                 <View style={styles.shopImgMock}><Text>Map Photo</Text></View>
                 <Text style={{fontWeight:'bold'}}>NewDays 新宿</Text>
                 <Text style={{fontSize:10, color:'#666'}}>駅構内 北通路</Text>
               </View>
             ))}
          </ScrollView>
        </View>

        <View style={styles.section}>
          <Text style={styles.h2}>{t.history}</Text>
          {history.length === 0 ? (
            <Text style={{color:'#999'}}>まだ履歴はありません</Text>
          ) : (
            history.map((v:any, i:number) => (
              <TouchableOpacity key={i} style={styles.historyItem}>
                <Text>📄 {v.station} : {v.title}</Text>
              </TouchableOpacity>
            ))
          )}
        </View>
      </ScrollView>
    </View>
  );
};

// --- 5. 検索画面 ---
const SearchScreen = ({ t, lang, videos, setVideos, setHistory }: any) => {
  const [type, setType] = useState('transfer');
  const [inputs, setInputs] = useState<any>({});
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [results, setResults] = useState<any[]>([]);
  const [viewingVideo, setViewingVideo] = useState<any>(null);

  useEffect(() => {
    let filtered = videos.filter((v:any) => v.type === type);
    const normalize = (str:string) => (str || '').toLowerCase().replace(/\s/g, '');
    
    if (inputs.station) filtered = filtered.filter((v:any) => normalize(v.station).includes(normalize(inputs.station)));
    if (inputs.fromLine) filtered = filtered.filter((v:any) => normalize(v.fromLine).includes(normalize(inputs.fromLine)));

    if (selectedTags.includes('shortest')) {
      filtered = filtered.filter((v:any) => 
        !v.tags.includes('wheelchair') && !v.tags.includes('elderly') && !v.tags.includes('baby')
      );
    }
    const normalTags = selectedTags.filter(tag => tag !== 'shortest');
    if (normalTags.length > 0) {
      filtered = filtered.filter((v:any) => normalTags.every(tag => v.tags.includes(tag)));
    }

    const scored = filtered.map((v:any) => ({
      ...v,
      totalScore: calculateTotalScore(v, selectedTags)
    }));

    scored.sort((a:any, b:any) => b.totalScore - a.totalScore);
    setResults(scored);

  }, [type, inputs, selectedTags, videos]);

  const toggleTag = (key: string) => {
    setSelectedTags(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  };

  if (viewingVideo) {
    return <VideoPlayerScreen 
      video={viewingVideo} 
      onClose={() => setViewingVideo(null)} 
      t={t} 
      setVideos={setVideos} 
      setHistory={setHistory}
    />;
  }

  return (
    <View style={styles.screen}>
      <View style={styles.searchTabs}>
        {Object.keys(t.searchTypes).map((key: any) => (
           <TouchableOpacity key={key} 
             style={[styles.miniTab, type===key && styles.miniTabActive]} 
             onPress={() => setType(key)}>
             <Text style={{fontSize:10, color: type===key?'white':'#333'}}>{t.searchTypes[key]}</Text>
           </TouchableOpacity>
        ))}
      </View>

      <ScrollView style={{padding:15}}>
        <TextInput style={styles.input} placeholder={`${t.labels.station} *`} onChangeText={t => setInputs({...inputs, station:t})} />
        {type === 'transfer' && (
          <>
            <TextInput style={styles.input} placeholder={t.labels.fromLine} onChangeText={t => setInputs({...inputs, fromLine:t})} />
            <TextInput style={styles.input} placeholder={t.labels.toLine} onChangeText={t => setInputs({...inputs, toLine:t})} />
          </>
        )}
        {(type === 'exit') && <TextInput style={styles.input} placeholder={t.labels.exit} onChangeText={t => setInputs({...inputs, exit:t})} />}
        {(type.includes('Shop')) && <TextInput style={styles.input} placeholder={t.labels.shopAddr} />}

        <View style={{flexDirection:'row', flexWrap:'wrap', gap:5, marginVertical:10}}>
          {Object.entries(t.tags).map(([key, label]:any) => (
            <TouchableOpacity key={key} 
              style={[styles.tag, selectedTags.includes(key) && styles.tagActive]}
              onPress={() => toggleTag(key)}>
              <Text style={{fontSize:12, color: selectedTags.includes(key)?'white':'#333'}}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.h2}>Results ({results.length})</Text>
        {results.length === 0 && (
          <Text style={{textAlign:'center', marginTop:20, color:'#999'}}>
            動画がありません。{'\n'}投稿画面から追加してください！
          </Text>
        )}
        
        {results.map((v:any) => (
          <TouchableOpacity key={v.id} style={styles.videoRow} onPress={() => setViewingVideo(v)}>
            <View style={styles.thumb}><Text>▶️</Text></View>
            <View style={{flex:1}}>
              <Text style={{fontWeight:'bold'}}>{v.station}</Text>
              <Text style={{fontSize:12}}>{v.title}</Text>
              <View style={{flexDirection:'row', marginTop:5}}>
                 <Text style={{fontSize:10, color:'#666'}}>Score: {Math.floor(v.totalScore)}</Text>
                 <Text style={{fontSize:10, color:'#666', marginLeft:10}}>Views: {v.views}</Text>
              </View>
              {v.warningFlag && <Text style={{color:'red', fontSize:10}}>⚠️ 情報が古い可能性があります</Text>}
            </View>
          </TouchableOpacity>
        ))}
        <View style={{height:100}}/>
      </ScrollView>
    </View>
  );
};

// --- 6. 動画再生 & アンケート ---
const VideoPlayerScreen = ({ video, onClose, t, setVideos, setHistory }: any) => {
  const [ended, setEnded] = useState(false);
  const [showSurvey, setShowSurvey] = useState(false);
  
  useEffect(() => {
    setHistory((prev:any[]) => [video, ...prev.filter((v:any) => v.id !== video.id)].slice(0, 10));
    setVideos((prev:any[]) => prev.map((v:any) => v.id === video.id ? {...v, views: v.views + 1} : v));
  }, []);

  const submitSurvey = (data: any) => {
    setVideos((prev:any[]) => prev.map((v:any) => {
      if (v.id === video.id) {
        const newSurveys = [...(v.surveys || []), { ...data, timestamp: Date.now() }];
        return { ...v, surveys: newSurveys };
      }
      return v;
    }));
    Alert.alert("感謝", "ご協力ありがとうございました！スコアに反映されます。");
    setShowSurvey(false);
  };

  return (
    <View style={styles.screen}>
      <TouchableOpacity onPress={onClose} style={{padding:15}}><Text>🔙 戻る</Text></TouchableOpacity>
      <Video
        source={{ uri: video.videoUri }}
        style={{width:'100%', height:250, backgroundColor:'black'}}
        useNativeControls
        resizeMode={ResizeMode.CONTAIN}
        shouldPlay
        onPlaybackStatusUpdate={(status:any) => {
          if (status.didJustFinish) setEnded(true);
        }}
      />
      <ScrollView style={{padding:15}}>
        <Text style={styles.h2}>{video.title}</Text>
        <TouchableOpacity 
          style={[styles.btn, !ended && {backgroundColor:'#ccc'}]} 
          disabled={!ended}
          onPress={() => setShowSurvey(true)}>
          <Text style={styles.btnText}>アンケートに協力する {ended ? "" : "(視聴後に有効)"}</Text>
        </TouchableOpacity>
        
        <View style={styles.articleBox}>
          <Text style={{fontWeight:'bold', marginBottom:10}}>🧭 AI自動生成ガイド</Text>
          <Text style={{lineHeight:22}}>{video.article}</Text>
        </View>
      </ScrollView>

      <Modal visible={showSurvey} transparent>
        <View style={styles.modalBg}>
           <View style={styles.modalContent}>
             <Text style={{fontWeight:'bold'}}>この情報は有効ですか？</Text>
             <View style={{flexDirection:'row', gap:10, marginVertical:10}}>
               <TouchableOpacity style={styles.tag} onPress={() => submitSurvey({stillValid:true, watchability:5, routeSatisfaction:5})}><Text>はい (満点)</Text></TouchableOpacity>
               <TouchableOpacity style={styles.tag} onPress={() => submitSurvey({stillValid:false, watchability:1, routeSatisfaction:1})}><Text>いいえ</Text></TouchableOpacity>
             </View>
             <Text style={{fontSize:10, color:'#666'}}>※デモのため簡易入力です</Text>
             <TouchableOpacity onPress={() => setShowSurvey(false)} style={{marginTop:20}}><Text>閉じる</Text></TouchableOpacity>
           </View>
        </View>
      </Modal>
    </View>
  );
};

// --- 7. 投稿画面（手ブレ・傾きに強い改良版） ---
const PostScreen = ({ t, lang, setScreen, setVideos }: any) => {
  const [mode, setMode] = useState('start'); 
  const [cameraPerm, requestCameraPerm] = useCameraPermissions();
  const cameraRef = useRef<any>(null);

  // センサー値
  const [currentDegree, setCurrentDegree] = useState(0);
  const [refDegree, setRefDegree] = useState(0);
  
  // ログ・表示用
  const [logs, setLogs] = useState<any[]>([]);
  const [actionLabel, setActionLabel] = useState("待機中");
  
  // タイマー管理
  const turnTimer = useRef<number>(0);
  const straightTimer = useRef<number>(0);
  
  // ★新機能：判定維持タイマー（デバウンス用）
  // 一瞬角度が外れても、この時間内なら判定を継続させる
  const keepAliveTimer = useRef<number>(0);
  const lastStatus = useRef<string>('straight');

  const [turnProgress, setTurnProgress] = useState(0); 
  const [straightProgress, setStraightProgress] = useState(1.0); 
  const [isResetting, setIsResetting] = useState(false);

  const [form, setForm] = useState<any>({ type: 'transfer', tags: [] });

  useEffect(() => {
    // 更新頻度を上げて滑らかにする
    DeviceMotion.setUpdateInterval(50);
    const sub = DeviceMotion.addListener(data => {
      if(data.rotation) {
        let d = (data.rotation.alpha * 180) / Math.PI;
        if(d < 0) d += 360;
        setCurrentDegree(d);
      }
    });
    return () => sub.remove();
  }, []);

  // ロジック判定（粘り強い判定版）
  useEffect(() => {
    if (mode !== 'recording' || isResetting) return;

    // 1. 相対角度の計算
    let rel = currentDegree - refDegree;
    while(rel < 0) rel += 360;
    while(rel >= 360) rel -= 360;

    // 2. 現在の瞬間の状態を判定（範囲を少し広げて 30~150度 に緩和）
    let currentStatus = 'straight';
    if(rel > 30 && rel < 150) currentStatus = 'right';
    else if(rel > 210 && rel < 330) currentStatus = 'left';

    // 3. 状態の「粘り」処理（ここが重要！）
    let effectiveStatus = currentStatus;

    if (currentStatus === 'straight' && lastStatus.current !== 'straight') {
      // 「さっきまで曲がってたのに、急に直進になった（手ブレかも？）」
      if (keepAliveTimer.current === 0) {
        keepAliveTimer.current = Date.now(); // 猶予タイム開始
      }
      
      const timeSinceLost = Date.now() - keepAliveTimer.current;
      if (timeSinceLost < 1500) {
        // 1.5秒以内なら、まだ「曲がっている」ことにする（判定維持）
        effectiveStatus = lastStatus.current;
      } else {
        // 1.5秒以上直進なら、本当に直進に戻ったとみなす
        lastStatus.current = 'straight';
        keepAliveTimer.current = 0;
      }
    } else if (currentStatus !== 'straight') {
      // 曲がっている状態なら、状態を更新してタイマーリセット
      lastStatus.current = currentStatus;
      keepAliveTimer.current = 0;
    }

    // 4. タイマー進行処理（effectiveStatus を使う）
    if(effectiveStatus !== 'straight') {
      // --- ターン中 ---
      straightTimer.current = 0;
      setStraightProgress(1.0);

      if(turnTimer.current === 0) turnTimer.current = Date.now();
      
      // 判定維持分も考慮して経過時間を計算
      // （判定が途切れても turnTimer はリセットされていないので継続される）
      const elapsed = Date.now() - turnTimer.current;
      setTurnProgress(Math.min(elapsed / 6000, 1.0));

      if(elapsed > 6000) {
        recordAction(effectiveStatus === 'right' ? '右折' : '左折');
      } else {
        // ユーザーへのフィードバック
        const remain = Math.ceil((6000-elapsed)/1000);
        if (currentStatus === 'straight') {
          // 判定維持モード中
          setActionLabel(`角度調整中...あと${remain}秒 (維持)`);
        } else {
          setActionLabel(`あと${remain}秒で ${effectiveStatus === 'right' ? '右折' : '左折'} 判定`);
        }
      }
    } else {
      // --- 直進中 ---
      turnTimer.current = 0;
      setTurnProgress(0);

      if(straightTimer.current === 0) straightTimer.current = Date.now();
      const elapsed = Date.now() - straightTimer.current;
      setStraightProgress(Math.max(0, 1.0 - (elapsed / 32000)));

      if(elapsed > 32000) {
        recordAction('直進');
        straightTimer.current = Date.now();
      } else {
        setActionLabel('直進中...');
      }
    }
  }, [currentDegree, refDegree, mode, isResetting]); // 依存配列

  const recordAction = (act: string) => {
    const timestamp = new Date(Date.now() - 8000).toLocaleTimeString();
    setLogs(prev => [...prev, { time: timestamp, action: act }]);
    
    setIsResetting(true);
    setActionLabel('ジャイロ更新中 🔄');
    
    // リセット時は全タイマーをクリア
    setTimeout(() => {
      setRefDegree(currentDegree);
      turnTimer.current = 0;
      setTurnProgress(0);
      straightTimer.current = Date.now();
      keepAliveTimer.current = 0;
      lastStatus.current = 'straight';
      setIsResetting(false);
    }, 1500);
  };

  const stopRecording = () => {
    cameraRef.current?.stopRecording();
    setMode('processing');
    setTimeout(() => {
      setMode('form');
    }, 2000);
  };

  const createPost = () => {
    setMode('generating');
    setTimeout(() => {
      const aiText = `【AI自動生成】\n1. 改札を出たらまずは直進です。\n` +
        logs.map(l => `・${l.time}頃、${l.action}方向へ進みます。\n`).join('') +
        `・最後、目的地に到着です！`;
      
      const newVideo = {
        id: Date.now().toString(),
        type: form.type,
        station: form.station || '名称未設定',
        title: `${form.station} ${form.fromLine || ''}→${form.toLine || ''}のルート`,
        fromLine: form.fromLine,
        toLine: form.toLine,
        exitNumber: form.exit,
        tags: form.tags,
        uploadDate: Date.now(),
        views: 0,
        rating: 0,
        article: aiText,
        videoUri: 'https://www.w3schools.com/html/mov_bbb.mp4', 
        surveys: []
      };

      setVideos((prev:any[]) => [newVideo, ...prev]);
      Alert.alert("投稿完了", t.uploadComplete, [{ text: "OK", onPress: () => setScreen('home') }]);
    }, 2000);
  };

  if(mode === 'start') {
    return (
      <View style={styles.center}>
        <Text style={styles.h2}>{t.postNoticeTitle}</Text>
        <Text style={{margin:20, lineHeight:24}}>{t.postNotice}</Text>
        <TouchableOpacity style={styles.btn} onPress={async () => {
          if(!cameraPerm?.granted) await requestCameraPerm();
          setMode('recording');
        }}><Text style={styles.btnText}>{t.postBtn}</Text></TouchableOpacity>
      </View>
    );
  }

  if(mode === 'recording') {
    return (
      <CameraView style={{flex:1}} mode="video" ref={cameraRef} onCameraReady={() => {
        setRefDegree(currentDegree);
        cameraRef.current?.recordAsync({ mute: true });
      }}>
        <View style={styles.overlay}>
           <View style={{marginTop:50}}>
             <Text style={{color:'white'}}>ターン判定</Text>
             <View style={styles.barBg}><View style={[styles.barFill, {width: `${turnProgress*100}%`, backgroundColor:'orange'}]}/></View>
             <Text style={{color:'white'}}>直進判定</Text>
             <View style={styles.barBg}><View style={[styles.barFill, {width: `${straightProgress*100}%`, backgroundColor:'cyan'}]}/></View>
           </View>
           <View style={styles.sensorBox}>
             <Text style={{color:'white', fontSize:20, fontWeight:'bold'}}>{actionLabel}</Text>
             {isResetting && <ActivityIndicator color="white"/>}
           </View>
           <TouchableOpacity style={styles.recBtn} onPress={stopRecording}><View style={styles.recInner}/></TouchableOpacity>
        </View>
      </CameraView>
    );
  }

  if(mode === 'processing' || mode === 'generating') {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#007AFF"/>
        <Text>{mode === 'processing' ? '顔ぼかし処理中...' : 'AI記事生成中...'}</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen}>
      <Text style={styles.h2}>情報入力</Text>
      
      <ScrollView horizontal style={{marginBottom:20}}>
        {Object.keys(t.searchTypes).map(k => (
          <TouchableOpacity key={k} style={[styles.tag, form.type===k && styles.tagActive]} onPress={() => setForm({...form, type:k})}>
            <Text style={{color:form.type===k?'white':'#333'}}>{t.searchTypes[k]}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <TextInput style={styles.input} placeholder={t.labels.station} onChangeText={t => setForm({...form, station:t})}/>
      {form.type === 'transfer' && (
        <>
          <TextInput style={styles.input} placeholder={t.labels.fromLine} onChangeText={t => setForm({...form, fromLine:t})}/>
          <TextInput style={styles.input} placeholder={t.labels.toLine} onChangeText={t => setForm({...form, toLine:t})}/>
        </>
      )}
      <Text style={{marginTop:10}}>タグ</Text>
      <View style={{flexDirection:'row', flexWrap:'wrap', gap:5}}>
        {Object.entries(t.tags).map(([k, l]:any) => (
          <TouchableOpacity key={k} 
            style={[styles.tag, form.tags.includes(k) && styles.tagActive]}
            onPress={() => {
               const newTags = form.tags.includes(k) ? form.tags.filter((tag:string) => tag!==k) : [...form.tags, k];
               setForm({...form, tags: newTags});
            }}>
            <Text style={{color:form.tags.includes(k)?'white':'#333'}}>{l}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity style={[styles.btn, {marginTop:30}]} onPress={createPost}>
        <Text style={styles.btnText}>記事を作成する</Text>
      </TouchableOpacity>
      <View style={{height:100}}/>
    </ScrollView>
  );
};
// --- スタイル ---
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5', paddingTop:40 },
  screen: { flex: 1, padding: 15 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  logo: { fontSize: 24, fontWeight: 'bold', color: '#007AFF' },
  langBtn: { padding: 8, backgroundColor:'#eee', borderRadius:20 },
  hero: { backgroundColor: '#007AFF', padding: 30, borderRadius: 15, alignItems: 'center', marginBottom: 20 },
  heroText: { color: 'white', fontSize: 18, fontWeight: 'bold', textAlign: 'center' },
  section: { marginBottom: 20 },
  h2: { fontSize: 18, fontWeight: 'bold', marginBottom: 10, color: '#333' },
  shopCard: { width: 120, marginRight: 10, backgroundColor: 'white', padding: 10, borderRadius: 8 },
  shopImgMock: { height: 80, backgroundColor: '#ddd', marginBottom: 5, justifyContent:'center', alignItems:'center' },
  historyItem: { padding: 15, backgroundColor: 'white', borderRadius: 8, marginBottom: 5, borderLeftWidth: 4, borderLeftColor: '#007AFF' },
  bottomNav: { flexDirection: 'row', padding: 10, backgroundColor: 'white', borderTopWidth: 1, borderColor: '#ddd' },
  navItem: { flex: 1, alignItems: 'center' },
  
  searchTabs: { flexDirection: 'row', flexWrap:'wrap', gap:5, padding:10 },
  miniTab: { padding:8, backgroundColor:'#ddd', borderRadius:15 },
  miniTabActive: { backgroundColor:'#007AFF' },
  input: { backgroundColor: 'white', padding: 12, borderRadius: 8, marginBottom: 10, borderWidth:1, borderColor:'#ddd' },
  tag: { padding: 8, backgroundColor: '#e0e0e0', borderRadius: 20 },
  tagActive: { backgroundColor: '#007AFF' },
  videoRow: { flexDirection: 'row', backgroundColor: 'white', padding: 10, borderRadius: 10, marginBottom: 10 },
  thumb: { width: 60, height: 60, backgroundColor: '#333', justifyContent:'center', alignItems:'center', marginRight:10 },

  btn: { backgroundColor: '#007AFF', padding: 15, borderRadius: 10, width: '100%', alignItems: 'center' },
  btnText: { color: 'white', fontWeight: 'bold' },
  overlay: { flex: 1, justifyContent: 'space-between', padding: 20 },
  barBg: { height: 8, backgroundColor: 'rgba(255,255,255,0.3)', borderRadius: 4, marginBottom: 10 },
  barFill: { height: 8, borderRadius: 4 },
  sensorBox: { alignSelf: 'center', backgroundColor: 'rgba(0,0,0,0.6)', padding: 15, borderRadius: 10, alignItems:'center' },
  recBtn: { alignSelf: 'center', width: 70, height: 70, borderRadius: 35, borderWidth: 5, borderColor: 'white', justifyContent:'center', alignItems:'center', marginBottom:20 },
  recInner: { width: 30, height: 30, backgroundColor: 'red', borderRadius: 5 },
  articleBox: { backgroundColor: '#e3f2fd', padding: 15, borderRadius: 10, marginTop: 20 },
  modalBg: { flex:1, backgroundColor:'rgba(0,0,0,0.5)', justifyContent:'center', alignItems:'center'},
  modalContent: { width:'80%', backgroundColor:'white', padding:20, borderRadius:10}
});
