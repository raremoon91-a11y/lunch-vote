import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import './App.css'

const COMPANY_LAT = 37.50585577
const COMPANY_LNG = 127.04085396

function formatDistance(distance) {
  if (!distance) return ''
  const meter = Number(distance)
  if (meter < 1000) return `${meter.toLocaleString()}m`
  return `${(meter / 1000).toFixed(1)}km`
}

const getMyUserId = () => {
  let uid = localStorage.getItem('voter_id')
  if (!uid) {
    uid = 'user_' + Math.random().toString(36).substr(2, 9)
    localStorage.setItem('voter_id', uid)
  }
  return uid
}

function App() {
  const [view, setView] = useState('vote') 
  const [isMapLoaded, setIsMapLoaded] = useState(false)
  const [isFavoritesOpen, setIsFavoritesOpen] = useState(false) 

  const [favorites, setFavorites] = useState([])
  const [votes, setVotes] = useState([])
  const myUserId = getMyUserId()

  const mapRef = useRef(null)
  const mapInstance = useRef(null)
  const placesService = useRef(null)
  const restaurantMarker = useRef(null)
  const restaurantInfoWindow = useRef(null)
  
  // 관리자(등록) 화면 검색어
  const [keyword, setKeyword] = useState('')
  const [searchPlacesResult, setSearchPlacesResult] = useState([])

  // 투표 화면 검색어
  const [voteKeyword, setVoteKeyword] = useState('')

  // =====================================================
  // 1. 초기 세팅
  // =====================================================
  useEffect(() => {
    fetchFavorites()
    fetchVotes()

    const subscription = supabase
      .channel('votes-channel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'votes' }, () => {
        fetchVotes()
      })
      .subscribe()

    const script = document.createElement('script')
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${import.meta.env.VITE_KAKAO_MAP_KEY}&autoload=false&libraries=services`
    script.onload = () => {
      window.kakao.maps.load(() => setIsMapLoaded(true))
    }
    document.head.appendChild(script)

    return () => supabase.removeChannel(subscription)
  }, [])

  const fetchFavorites = async () => {
    const { data } = await supabase.from('favorites').select('*')
    if (data) setFavorites(data)
  }

  const fetchVotes = async () => {
    const { data } = await supabase.from('votes').select('*')
    if (data) setVotes(data)
  }

  // =====================================================
  // 2. 지도 초기화
  // =====================================================
  useEffect(() => {
    if (view === 'admin' && isMapLoaded && !mapInstance.current && mapRef.current) {
      const companyPosition = new window.kakao.maps.LatLng(COMPANY_LAT, COMPANY_LNG)
      const map = new window.kakao.maps.Map(mapRef.current, { center: companyPosition, level: 4 })
      mapInstance.current = map

      const companyMarkerContent = `<div style="padding:3px 6px; background:red; color:white; border-radius:4px; font-size:12px; font-weight:bold;">회사</div>`
      const companyOverlay = new window.kakao.maps.CustomOverlay({
        position: companyPosition, content: companyMarkerContent, xAnchor: 0, yAnchor: 0.5
      })
      companyOverlay.setMap(map)
      placesService.current = new window.kakao.maps.services.Places()
    }
  }, [view, isMapLoaded])

  // =====================================================
  // 3. 관리자 화면 기능
  // =====================================================
  const executeSearch = () => {
    if (!keyword.trim()) return alert('음식점 이름을 입력해주세요.')
    if (!placesService.current) return
    
    if (restaurantMarker.current) restaurantMarker.current.setMap(null)
    if (restaurantInfoWindow.current) restaurantInfoWindow.current.close()

    placesService.current.keywordSearch(keyword, (data, status) => {
      if (status === window.kakao.maps.services.Status.OK) {
        const sorted = [...data].sort((a, b) => Number(a.distance) - Number(b.distance))
        setSearchPlacesResult(sorted)
        mapInstance.current.panTo(new window.kakao.maps.LatLng(Number(sorted[0].y), Number(sorted[0].x)))
      } else {
        setSearchPlacesResult([])
        alert('검색 결과가 없습니다.')
      }
    }, { location: new window.kakao.maps.LatLng(COMPANY_LAT, COMPANY_LNG), radius: 3000, category_group_code: 'FD6' })
  }

  const showPlaceInfo = (place) => {
    if (!mapInstance.current) return
    if (!place.y || !place.x) return
    
    const position = new window.kakao.maps.LatLng(Number(place.y), Number(place.x))

    if (restaurantMarker.current) restaurantMarker.current.setMap(null)
    if (restaurantInfoWindow.current) restaurantInfoWindow.current.close()

    const marker = new window.kakao.maps.Marker({ position })
    marker.setMap(mapInstance.current)
    restaurantMarker.current = marker
    mapInstance.current.panTo(position)

    const address = place.road_address_name || place.address_name
    const infoContent = `
      <div style="width:240px; padding:15px; font-family:Arial,sans-serif;">
        <div style="font-size:16px; font-weight:bold; margin-bottom:8px;">🍚 ${place.place_name}</div>
        <div style="font-size:13px; color:#555; margin-bottom:10px;">📍 ${address}</div>
        ${place.place_url ? `<a href="${place.place_url}" target="_blank" rel="noopener noreferrer" style="display:block; padding:8px; background:#222; color:white; text-align:center; text-decoration:none; border-radius:6px; font-size:13px;">카카오맵 상세보기</a>` : ''}
      </div>
    `
    const infoWindow = new window.kakao.maps.InfoWindow({ content: infoContent })
    infoWindow.open(mapInstance.current, marker)
    restaurantInfoWindow.current = infoWindow
  }

  const handleFavoriteClick = (fav) => {
    if (!placesService.current) return
    placesService.current.keywordSearch(fav.place_name, (data, status) => {
      if (status === window.kakao.maps.services.Status.OK) {
        const match = data.find(d => String(d.id) === fav.place_id) || data[0]
        setSearchPlacesResult([match])
        showPlaceInfo(match)
      } else {
        alert('카카오맵에서 상세 정보를 찾을 수 없습니다.')
      }
    }, { location: new window.kakao.maps.LatLng(COMPANY_LAT, COMPANY_LNG) })
  }

  const toggleFavorite = async (place) => {
    const isFav = favorites.find(f => f.place_id === String(place.id))
    if (isFav) {
      removeFavorite(String(place.id))
    } else {
      const menuInput = prompt(`[${place.place_name}]의 대표 메뉴를 입력해주세요!\n(예: 제육볶음, 돈까스 / 없으면 그냥 확인)`)
      const menuText = menuInput ? menuInput.trim() : null
      const newFav = {
        place_id: String(place.id), place_name: place.place_name, address: place.road_address_name || place.address_name, category_name: place.category_name, distance: place.distance, menu: menuText 
      }
      await supabase.from('favorites').insert([newFav])
      setFavorites([...favorites, newFav])
    }
  }

  const removeFavorite = async (placeId) => {
    await supabase.from('favorites').delete().eq('place_id', placeId)
    setFavorites(favorites.filter(f => f.place_id !== placeId))
    await supabase.from('votes').delete().eq('place_id', placeId)
    setSearchPlacesResult([]) 
  }

  const editMenu = async (placeId, currentMenu, placeName) => {
    const menuInput = prompt(`[${placeName}]의 새로운 대표 메뉴를 입력해주세요!`, currentMenu || '')
    if (menuInput !== null) {
      const menuText = menuInput.trim()
      await supabase.from('favorites').update({ menu: menuText }).eq('place_id', placeId)
      setFavorites(favorites.map(f => f.place_id === placeId ? { ...f, menu: menuText } : f))
    }
  }

  // =====================================================
  // 4. 투표 화면 기능 & 통계 계산
  // =====================================================
  const handleVote = async (favPlace) => {
    const myPreviousVote = votes.find(v => v.user_id === myUserId)
    if (myPreviousVote) {
      if (myPreviousVote.place_id === favPlace.place_id) {
        await supabase.from('votes').delete().eq('id', myPreviousVote.id) 
      } else {
        await supabase.from('votes').update({ place_id: favPlace.place_id, place_name: favPlace.place_name }).eq('id', myPreviousVote.id) 
      }
    } else {
      await supabase.from('votes').insert([{ place_id: favPlace.place_id, place_name: favPlace.place_name, user_id: myUserId }])
    }
  }

  const myCurrentVote = votes.find(v => v.user_id === myUserId)

  // 득표수 집계
  const voteCounts = {}
  votes.forEach(v => {
    voteCounts[v.place_id] = (voteCounts[v.place_id] || 0) + 1
  })
  
  const totalVotes = votes.length
  const maxVotes = totalVotes > 0 ? Math.max(...Object.values(voteCounts)) : 0

  const firstPlaceNames = maxVotes > 0 
    ? favorites.filter(fav => voteCounts[fav.place_id] === maxVotes).map(fav => fav.place_name)
    : []

  // ✅ 투표 화면: 검색어 필터링 + (1순위: 득표순, 2순위: 거리순) 정렬 적용
  const displayedFavorites = favorites
    .filter(fav => 
      fav.place_name.includes(voteKeyword) || 
      (fav.menu && fav.menu.includes(voteKeyword))
    )
    .sort((a, b) => {
      const aVotes = voteCounts[a.place_id] || 0
      const bVotes = voteCounts[b.place_id] || 0
      
      // 1순위: 득표수가 다르면 득표수 높은 순(내림차순)
      if (aVotes !== bVotes) {
        return bVotes - aVotes
      }
      
      // 2순위: 득표수가 같으면 거리가 가까운 순(오름차순)
      return Number(a.distance) - Number(b.distance)
    })

  // =====================================================
  // 렌더링
  // =====================================================
  return (
    <div className="app">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h1 style={{ margin: 0, fontSize: '24px' }}>🍚 {view === 'vote' ? '오늘 뭐 먹지?' : '맛집 즐겨찾기 설정'}</h1>
        <button 
          onClick={() => {
            setView(view === 'vote' ? 'admin' : 'vote');
            setVoteKeyword(''); // 화면 전환 시 검색어 초기화
          }}
          style={{ padding: '8px 12px', background: '#333', color: '#fff', borderRadius: '6px', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}
        >
          {view === 'vote' ? '⚙️ 맛집 등록하기' : '◀ 투표 화면으로'}
        </button>
      </div>

      {/* ---------------------------------------------------- */}
      {/* [화면 1] 투표 화면 */}
      {/* ---------------------------------------------------- */}
      {view === 'vote' && (
        <div className="vote-view">
          
          {totalVotes > 0 && (
            <div style={{ background: '#222', color: 'white', padding: '16px', borderRadius: '12px', marginBottom: '20px', textAlign: 'center', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}>
              <div style={{ fontSize: '14px', marginBottom: '8px', color: '#ccc' }}>현재 총 <strong style={{ color: '#fff', fontSize: '16px' }}>{totalVotes}</strong>명 참여 중</div>
              <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#ffd700' }}>
                🥇 1위: {firstPlaceNames.join(', ')} ({maxVotes}표)
              </div>
            </div>
          )}

          {/* 투표 화면용 맛집/메뉴 검색창 */}
          {favorites.length > 0 && (
            <div className="search-box" style={{ marginBottom: '20px' }}>
              <input
                type="text"
                placeholder="🔍 식당 이름이나 메뉴(제육, 돈까스 등)를 검색해보세요"
                value={voteKeyword}
                onChange={(e) => setVoteKeyword(e.target.value)}
                style={{ background: '#fff' }}
              />
            </div>
          )}

          {favorites.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px', background: '#f8f9fa', borderRadius: '12px' }}>
              <p>등록된 맛집 후보가 없습니다.</p>
              <button onClick={() => setView('admin')} style={{ padding: '10px 20px', background: '#2196f3', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}>
                후보 등록하러 가기
              </button>
            </div>
          ) : displayedFavorites.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px', background: '#f8f9fa', borderRadius: '12px', color: '#888' }}>
              <p>검색 결과가 없습니다.</p>
            </div>
          ) : (
            <div className="results" style={{ display: 'flex', flexDirection: 'column', gap: '16px', paddingRight: '10px' }}>
              
              {/* 필터링 및 다중 정렬(득표순->거리순)된 리스트 출력 */}
              {displayedFavorites.map((fav) => {
                const currentVotes = voteCounts[fav.place_id] || 0
                const percentage = totalVotes > 0 ? Math.round((currentVotes / totalVotes) * 100) : 0
                const isMyVote = myCurrentVote?.place_id === fav.place_id
                const isFirstPlace = maxVotes > 0 && currentVotes === maxVotes

                return (
                  <div key={fav.place_id} style={{ 
                    background: 'white', padding: '16px', borderRadius: '12px', textAlign: 'left',
                    border: isFirstPlace ? '2px solid #ffd700' : isMyVote ? '2px solid #2196f3' : '1px solid #e0e0e0',
                    boxShadow: isFirstPlace ? '0 4px 12px rgba(255, 215, 0, 0.2)' : '0 2px 8px rgba(0,0,0,0.05)',
                  }}>
                    
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', marginBottom: '8px' }}>
  
                      <h3 style={{ margin: '0 0 8px 0', fontSize: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: '6px' }}>
                        {fav.place_name}
                        {isFirstPlace && <span style={{ background: '#fff9c4', color: '#f57f17', fontSize: '11px', padding: '2px 6px', borderRadius: '4px' }}>🥇 현재 1위</span>}
                        {fav.menu && <span style={{ background: '#e3f2fd', color: '#1976d2', fontSize: '11px', padding: '2px 6px', borderRadius: '4px' }}>🥘 {fav.menu}</span>}
                      </h3>

                      {/* 거리(m)를 주소 앞으로 이동 및 한 줄로 정렬 */}
                      <p style={{ margin: '0 0 4px 0', fontSize: '13px', color: '#666' }}>
                        🏢 {formatDistance(fav.distance)} · 📍 {fav.address}
                      </p>

                    </div>

                    <div style={{ background: '#f5f5f5', height: '10px', borderRadius: '5px', overflow: 'hidden', margin: '14px 0', position: 'relative' }}>
                      <div style={{
                        width: `${percentage}%`, height: '100%',
                        background: isFirstPlace ? '#ffd700' : (isMyVote ? '#2196f3' : '#90caf9'),
                        transition: 'width 0.4s ease-in-out'
                      }} />
                      {percentage > 0 && <span style={{ position: 'absolute', right: '4px', top: '-1px', fontSize: '9px', color: '#333' }}>{percentage}%</span>}
                    </div>
                    
                    <button
                      onClick={() => handleVote(fav)}
                      style={{ 
                        width: '100%', padding: '12px', fontWeight: 'bold', border: 'none', borderRadius: '8px', cursor: 'pointer',
                        background: isMyVote ? '#ffebee' : '#f0f8ff',
                        color: isMyVote ? '#d32f2f' : '#1976d2',
                        transition: 'background 0.2s',
                        display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '6px'
                      }}
                    >
                      {isMyVote ? '❌ 내 투표 취소' : myCurrentVote ? '🔄 여기로 표 옮기기' : '👍 투표하기'}
                    </button>

                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ---------------------------------------------------- */}
      {/* [화면 2] 즐겨찾기 등록 화면 (관리자) */}
      {/* ---------------------------------------------------- */}
      {view === 'admin' && (
        <div className="admin-view">
          
          <div className="search-box">
            <input
              type="text" placeholder="맛집 이름을 검색하세요" value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') executeSearch() }}
            />
            <button onClick={executeSearch}>검색</button>
          </div>

          <div className="content">
            <div ref={mapRef} className="map" />
            <div className="results">
              <h2>카카오맵 검색 결과</h2>
              {searchPlacesResult.length === 0 ? (
                <p className="empty">음식점을 검색해서 즐겨찾기에 등록하거나 아래 목록을 선택하세요.</p>
              ) : (
                searchPlacesResult.map((place) => {
                  const isFav = favorites.find(f => f.place_id === String(place.id))
                  return (
                    <div className="place" key={place.id}>
                      <h3>{place.place_name}</h3>
                      <p className="address">📍 {place.road_address_name || place.address_name}</p>
                      <p className="distance">🏢 회사에서 {formatDistance(place.distance)}</p>
                      
                      <div className="place-actions" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '10px' }}>
                        <button onClick={() => showPlaceInfo(place)} style={{ flex: '1 1 45%' }}>상세 보기</button>
                        <button 
                          onClick={() => toggleFavorite(place)}
                          style={{ flex: '1 1 45%', background: isFav ? '#ff9800' : '#4caf50', color: '#fff' }}
                        >
                          {isFav ? '❌ 즐겨찾기 해제' : '⭐ 등록하기'}
                        </button>
                        {isFav && (
                          <button 
                            onClick={() => editMenu(String(place.id), isFav.menu, place.place_name)} 
                            style={{ flex: '1 1 100%', background: '#2196f3', color: 'white', padding: '8px' }}
                          >
                            ✏️ 대표 메뉴 수정
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>

          <div style={{ marginTop: '20px', padding: '15px', background: '#fff8e1', borderRadius: '8px', border: '1px solid #ffe082' }}>
            <h3 
              onClick={() => setIsFavoritesOpen(!isFavoritesOpen)}
              style={{ margin: 0, fontSize: '16px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
            >
              <span>⭐ 현재 등록된 즐겨찾기 ({favorites.length}개)</span>
              <span style={{ fontSize: '13px', color: '#666', background: '#ffe082', padding: '4px 8px', borderRadius: '12px' }}>
                {isFavoritesOpen ? '▲ 접기' : '▼ 펼치기'}
              </span>
            </h3>

            {isFavoritesOpen && (
              <div style={{ marginTop: '15px' }}>
                {favorites.length === 0 ? (
                  <p style={{ margin: 0, fontSize: '13px', color: '#888' }}>아직 등록된 맛집이 없습니다. 검색 후 등록해주세요.</p>
                ) : (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                    {favorites.map((fav) => (
                      <div 
                        key={fav.place_id} 
                        onClick={() => handleFavoriteClick(fav)}
                        style={{ background: 'white', padding: '6px 12px', borderRadius: '20px', border: '1px solid #ffcc80', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}
                      >
                        <span style={{ fontWeight: 'bold' }}>
                          {fav.place_name} 
                          {fav.menu && <span style={{ color: '#888', fontWeight: 'normal', marginLeft: '4px' }}>({fav.menu})</span>}
                        </span>
                        
                        <button 
                          onClick={(e) => { 
                            e.stopPropagation();
                            removeFavorite(fav.place_id); 
                          }} 
                          style={{ background: 'none', border: 'none', color: '#e53935', cursor: 'pointer', padding: 0, fontSize: '16px', lineHeight: 1 }}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

        </div>
      )}
      
    </div>
  )
}

export default App