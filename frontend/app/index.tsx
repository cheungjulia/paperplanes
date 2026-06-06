import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Camera, Images, LineLayer, LocationPuck, MapView, MarkerView, ShapeSource, SymbolLayer } from '@rnmapbox/maps';
import Svg, { Defs, Polyline, RadialGradient, Rect, Stop } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MAPBOX_STYLE_URL } from '../src/config/mapbox';
import type { PlaneKind, PlaneMemory, PlaneVisibility, SketchStroke } from '../src/types/memory';
import { encodeGeohash } from '../src/utils/geohash';
import { createMemory, echoMemory, fetchMemories } from '../src/utils/memoriesApi';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const paperplanePin = require('../assets/paperplane-pin.png');
const paperOpenImg = require('../assets/paper-open-btn.png');
const scrunchedImg = require('../assets/scrunched-btn.png');

/* ─── palette ─── */
const C = {
  milk: '#f5f7fa',
  cream: '#edf1f5',
  walnut: '#3a4250',
  clay: '#a0a9b5',
  terracotta: '#b0c8de',
  terracottaFaded: 'rgba(176, 200, 222, 0.3)',
  glass: 'rgba(245, 247, 250, 0.82)',
  glassDense: 'rgba(245, 247, 250, 0.92)',
  line: 'rgba(160, 169, 181, 0.18)',
  sketchStroke: '#9aaab8',
  transparent: 'transparent',
  vignetteWhite: '#ffffff',
};

const SERIF = Platform.OS === 'ios' ? 'Georgia' : 'serif';
const DEFAULT_CENTER: [number, number] = [121.5654, 25.033];

const DEMO_FRIENDS = [
  { id: 'mina', name: 'Mina' },
  { id: 'jules', name: 'Jules' },
  { id: 'kai', name: 'Kai' },
  { id: 'ren', name: 'Ren' },
] as const;

const DEMO_DELAYS = [
  { id: 'soon', label: 'soon', minutes: 5 },
  { id: 'tonight', label: 'tonight', minutes: 180 },
  { id: 'tomorrow', label: 'tomorrow', minutes: 24 * 60 },
] as const;

/* ─── helpers ─── */

const PIN_KINDS: PlaneKind[] = ['private', 'public', 'directed'];

/** Group memories by exact geohash cell so seeded clusters stay as distinct pins. */
function groupMemoriesByArea(memories: PlaneMemory[]): Map<string, PlaneMemory[]> {
  const groups = new Map<string, PlaneMemory[]>();
  for (const m of memories) {
    const key = m.geohash;
    const list = groups.get(key) ?? [];
    list.push(m);
    groups.set(key, list);
  }
  return groups;
}

function groupMemoriesByPinKind(memories: PlaneMemory[]): Record<PlaneKind, Map<string, PlaneMemory[]>> {
  return PIN_KINDS.reduce((groups, kind) => {
    groups[kind] = groupMemoriesByArea(memories.filter((memory) => pinKindForMemory(memory) === kind));
    return groups;
  }, {} as Record<PlaneKind, Map<string, PlaneMemory[]>>);
}

function pinKindForMemory(memory: PlaneMemory): PlaneKind {
  if (memory.kind === 'directed') return 'directed';
  return memory.visibility === 'folded' ? 'private' : 'public';
}

function hasActiveFlightPath(
  memory: PlaneMemory,
  nowMs: number,
): memory is PlaneMemory & { origin_latitude: number; origin_longitude: number } {
  if (pinKindForMemory(memory) !== 'directed') return false;
  if (typeof memory.origin_latitude !== 'number' || typeof memory.origin_longitude !== 'number') return false;
  if (!memory.arrives_at) return true;
  const arrivesAtMs = Date.parse(memory.arrives_at);
  return Number.isNaN(arrivesAtMs) || arrivesAtMs > nowMs;
}

function featureCollectionForGroups(groups: Map<string, PlaneMemory[]>) {
  return {
    type: 'FeatureCollection' as const,
    features: Array.from(groups.entries()).map(([key, group]) => {
      const longitude = group.reduce((sum, m) => sum + m.longitude, 0) / group.length;
      const latitude = group.reduce((sum, m) => sum + m.latitude, 0) / group.length;
      return {
        type: 'Feature' as const,
        id: key,
        properties: {
          key,
          count: group.length,
          countLabel: group.length > 1 ? String(group.length) : '',
        },
        geometry: {
          type: 'Point' as const,
          coordinates: [longitude, latitude],
        },
      };
    }),
  };
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    const month = d.toLocaleString('en', { month: 'short' }).toLowerCase();
    const day = d.getDate();
    const hour = d.getHours();
    const min = d.getMinutes().toString().padStart(2, '0');
    const ampm = hour >= 12 ? 'pm' : 'am';
    const h = hour % 12 || 12;
    return `${month} ${day}, ${h}:${min}${ampm}`;
  } catch {
    return '';
  }
}

function photoUri(photoBase64?: string | null, mimeType?: string | null): string | null {
  if (!photoBase64) return null;
  if (photoBase64.startsWith('data:')) return photoBase64;
  const inferredMime =
    mimeType ||
    (photoBase64.startsWith('iVBOR') ? 'image/png' :
      photoBase64.startsWith('R0lG') ? 'image/gif' :
        photoBase64.startsWith('UklGR') ? 'image/webp' :
          'image/jpeg');
  return `data:${inferredMime};base64,${photoBase64}`;
}

/* ─── main screen ─── */

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const cameraRef = useRef<Camera>(null);
  const [center, setCenter] = useState<[number, number]>(DEFAULT_CENTER);
  const [userCenter, setUserCenter] = useState<[number, number]>(DEFAULT_CENTER);
  const [pin, setPin] = useState({ latitude: DEFAULT_CENTER[1], longitude: DEFAULT_CENTER[0] });
  const [memories, setMemories] = useState<PlaneMemory[]>([]);
  const [loadingLocation, setLoadingLocation] = useState(true);
  const [pinDropMode, setPinDropMode] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<PlaneMemory[] | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (permission.status !== 'granted') return;
        const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (cancelled) return;
        const nextCenter: [number, number] = [location.coords.longitude, location.coords.latitude];
        setCenter(nextCenter);
        setUserCenter(nextCenter);
        setPin({ latitude: nextCenter[1], longitude: nextCenter[0] });
        cameraRef.current?.setCamera({
          centerCoordinate: nextCenter,
          zoomLevel: 14,
          animationDuration: 800,
        });
      } finally {
        if (!cancelled) setLoadingLocation(false);
      }
    })();
    loadMemories();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  async function loadMemories() {
    try {
      setMemories(await fetchMemories());
    } catch (error) {
      console.warn('[fold] failed to load memories', error);
    }
  }

  async function handleSave(input: SavePlaneInput) {
    const memory = await createMemory({
      ...input,
      latitude: pin.latitude,
      longitude: pin.longitude,
      geohash: encodeGeohash(pin.latitude, pin.longitude),
      originLatitude: input.kind === 'directed' ? userCenter[1] : undefined,
      originLongitude: input.kind === 'directed' ? userCenter[0] : undefined,
    });
    setMemories((current) => [...current, memory]);
    setComposerOpen(false);
    // Zoom back out to see the new memory on the map
    cameraRef.current?.setCamera({
      centerCoordinate: [pin.longitude, pin.latitude],
      zoomLevel: 14,
      animationDuration: 500,
    });
  }

  function enterPinDropMode() {
    setPinDropMode(true);
    // Reset pin to current location and zoom in tight
    setPin({ latitude: center[1], longitude: center[0] });
    cameraRef.current?.setCamera({
      centerCoordinate: center,
      zoomLevel: 17,
      animationDuration: 500,
    });
  }

  function confirmPinDrop() {
    setPinDropMode(false);
    setComposerOpen(true);
  }

  function cancelPinDrop() {
    setPinDropMode(false);
    // Zoom back out
    cameraRef.current?.setCamera({
      centerCoordinate: center,
      zoomLevel: 14,
      animationDuration: 500,
    });
  }

  async function handleEcho(memory: PlaneMemory) {
    try {
      const next = !memory.echoed_by_me;
      const result = await echoMemory(memory.id, next);
      setMemories((current) =>
        current.map((item) =>
          item.id === memory.id
            ? { ...item, echo_count: result.echo_count, echoed_by_me: result.echoed_by_me }
            : item,
        ),
      );
      setSelectedGroup((current) =>
        current
          ? current.map((item) =>
            item.id === memory.id
              ? { ...item, echo_count: result.echo_count, echoed_by_me: result.echoed_by_me }
              : item,
          )
          : current,
      );
    } catch {
      Alert.alert('could not echo this plane.');
    }
  }

  // Group memories into separate pin kinds so each state gets its own map icon.
  const groupsByKind = useMemo(() => groupMemoriesByPinKind(memories), [memories]);
  const featureCollectionsByKind = useMemo(() => ({
    private: featureCollectionForGroups(groupsByKind.private),
    public: featureCollectionForGroups(groupsByKind.public),
    directed: featureCollectionForGroups(groupsByKind.directed),
  }), [groupsByKind]);
  const directedRouteCollection = useMemo(() => ({
    type: 'FeatureCollection' as const,
    features: memories
      .filter((memory) => hasActiveFlightPath(memory, nowMs))
      .map((memory) => ({
        type: 'Feature' as const,
        id: `${memory.id}-route`,
        properties: {
          id: memory.id,
        },
        geometry: {
          type: 'LineString' as const,
          coordinates: [
            [memory.origin_longitude, memory.origin_latitude],
            [memory.longitude, memory.latitude],
          ],
        },
      })),
  }), [memories, nowMs]);

  function openMemoryGroup(kind: PlaneKind, key: string) {
    const group = groupsByKind[kind].get(key);
    if (!group) return;
    const sorted = [...group].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
    setSelectedGroup(sorted);
  }

  const foldedCount = useMemo(() => memories.filter((m) => pinKindForMemory(m) === 'private').length, [memories]);
  const freeCount = useMemo(() => memories.filter((m) => pinKindForMemory(m) === 'public').length, [memories]);
  const sentCount = useMemo(() => memories.filter((m) => pinKindForMemory(m) === 'directed').length, [memories]);

  return (
    <View style={s.screen}>
      {/* ── map ── */}
      <MapView
        style={StyleSheet.absoluteFill}
        styleURL={MAPBOX_STYLE_URL}
        scaleBarEnabled={false}
        compassEnabled={false}
        scrollEnabled
        zoomEnabled
        rotateEnabled={!pinDropMode}
        pitchEnabled={false}
        onLongPress={(feature) => {
          if (pinDropMode) {
            const [longitude, latitude] = feature.geometry.coordinates;
            setPin({ latitude, longitude });
          }
        }}
        onPress={(feature) => {
          if (pinDropMode) {
            const [longitude, latitude] = feature.geometry.coordinates;
            setPin({ latitude, longitude });
          } else if (selectedGroup) {
            setSelectedGroup(null);
          }
        }}
      >
        <Camera
          ref={cameraRef}
          defaultSettings={{ centerCoordinate: center, zoomLevel: 14, pitch: 0, heading: 0 }}
        />
        <Images images={{ paperplanePin, paperOpenPin: paperOpenImg, scrunchedPin: scrunchedImg }} />
        <LocationPuck visible puckBearingEnabled={false} />

        {/* drop pin — only visible in pin drop mode */}
        {pinDropMode && (
          <MarkerView coordinate={[pin.longitude, pin.latitude]} allowOverlap>
            <Image source={paperplanePin} style={s.pinImage} />
          </MarkerView>
        )}

        <ShapeSource id="directed-plane-routes" shape={directedRouteCollection}>
          <LineLayer
            id="directed-plane-route-lines"
            minZoomLevel={0}
            maxZoomLevel={24}
            style={{
              lineColor: C.terracotta,
              lineWidth: 2,
              lineOpacity: 0.7,
              lineDasharray: [1.5, 2.2],
              lineCap: 'round',
              lineJoin: 'round',
            } as any}
          />
        </ShapeSource>

        {/* memory pins: private = scrunched, public = open paper, directed = paper plane */}
        <MemoryPinLayer
          id="private-memory-pins"
          iconImage="scrunchedPin"
          shape={featureCollectionsByKind.private}
          onOpen={(key) => openMemoryGroup('private', key)}
          iconSize={1.05}
          iconTranslate={[-18, 0]}
        />
        <MemoryPinLayer
          id="public-memory-pins"
          iconImage="paperOpenPin"
          shape={featureCollectionsByKind.public}
          onOpen={(key) => openMemoryGroup('public', key)}
          iconSize={1.05}
          iconTranslate={[18, 0]}
        />
        <MemoryPinLayer
          id="directed-memory-pins"
          iconImage="paperplanePin"
          shape={featureCollectionsByKind.directed}
          onOpen={(key) => openMemoryGroup('directed', key)}
          iconSize={3.0}
          iconTranslate={[0, -18]}
        />
      </MapView>

      {/* ── vignette overlay (SVG radial gradient) ── */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Svg width="100%" height="100%" preserveAspectRatio="none">
          <Defs>
            <RadialGradient id="vig" cx="50%" cy="50%" rx="45%" ry="42%">
              <Stop offset="0" stopColor={C.vignetteWhite} stopOpacity="0" />
              <Stop offset="0.55" stopColor={C.vignetteWhite} stopOpacity="0" />
              <Stop offset="0.75" stopColor={C.vignetteWhite} stopOpacity="0.4" />
              <Stop offset="0.88" stopColor={C.vignetteWhite} stopOpacity="0.75" />
              <Stop offset="1" stopColor={C.vignetteWhite} stopOpacity="1" />
            </RadialGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#vig)" />
        </Svg>
      </View>

      {/* ── floating header ── */}
      <View style={[s.header, { paddingTop: insets.top + 16 }]} pointerEvents="none">
        <Text style={s.appName}>fold</Text>
        <Text style={s.subtitle}>
          {foldedCount} folded{' '}<Text style={s.subtitleSep}>&middot;</Text>{' '}
          {freeCount} in the air{' '}<Text style={s.subtitleSep}>&middot;</Text>{' '}
          {sentCount} sent
        </Text>
      </View>

      {/* ── loading ── */}
      {loadingLocation && (
        <View style={s.loading}>
          <ActivityIndicator color={C.clay} size="small" />
          <Text style={s.loadingText}>finding you...</Text>
        </View>
      )}

      {/* ── bulletin (scrollable grouped memories) ── */}
      {selectedGroup && (
        <BulletinView
          memories={selectedGroup}
          onClose={() => setSelectedGroup(null)}
          onEcho={handleEcho}
          bottomInset={insets.bottom}
        />
      )}

      {/* ── composer ── */}
      {composerOpen && (
        <ComposerPanel
          onClose={() => setComposerOpen(false)}
          onSave={handleSave}
          bottomInset={insets.bottom}
        />
      )}

      {/* ── pin drop mode UI ── */}
      {pinDropMode && (
        <View style={[s.pinDropUI, { paddingBottom: insets.bottom + 24 }]}>
          <Text style={s.pinDropHint}>pan anywhere, then tap to place your plane</Text>
          <View style={s.pinDropActions}>
            <Pressable onPress={cancelPinDrop} hitSlop={12}>
              <Text style={s.pinDropCancel}>cancel</Text>
            </Pressable>
            <Pressable onPress={confirmPinDrop} style={s.pinDropConfirm}>
              <Text style={s.pinDropConfirmText}>drop here</Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* ── compose button ── */}
      {!composerOpen && !selectedGroup && !pinDropMode && (
        <View style={[s.composeButtonWrap, { paddingBottom: insets.bottom + 24 }]}>
          <Pressable onPress={enterPinDropMode}>
            <Image source={paperplanePin} style={s.composeButtonPlane} />
          </Pressable>
          <Text style={s.composeHint}>leave something here</Text>
        </View>
      )}
    </View>
  );
}

function MemoryPinLayer({
  id,
  iconImage,
  shape,
  iconSize,
  iconTranslate,
  onOpen,
}: {
  id: string;
  iconImage: string;
  shape: ReturnType<typeof featureCollectionForGroups>;
  iconSize: number;
  iconTranslate: [number, number];
  onOpen: (key: string) => void;
}) {
  return (
    <ShapeSource
      id={id}
      shape={shape}
      hitbox={{ width: 112, height: 112 }}
      onPress={(event) => {
        const key = event.features?.[0]?.properties?.key;
        if (key) onOpen(String(key));
      }}
    >
      <SymbolLayer
        id={`${id}-symbols`}
        minZoomLevel={0}
        maxZoomLevel={24}
        style={{
          iconImage,
          iconSize,
          iconTranslate,
          iconAllowOverlap: true,
          iconIgnorePlacement: true,
        } as any}
      />
      <SymbolLayer
        id={`${id}-counts`}
        minZoomLevel={0}
        maxZoomLevel={24}
        style={{
          textField: ['get', 'countLabel'],
          textSize: 11,
          textColor: C.walnut,
          textHaloColor: C.milk,
          textHaloWidth: 1.5,
          textTranslate: [iconTranslate[0] + 30, iconTranslate[1] - 24],
          textAllowOverlap: true,
          textIgnorePlacement: true,
        } as any}
      />
    </ShapeSource>
  );
}

/* ─── types ─── */

interface SavePlaneInput {
  body: string;
  linkUrl?: string;
  sketchJson: string;
  photoBase64?: string;
  photoMimeType?: string;
  authorName?: string;
  kind?: PlaneKind;
  recipientName?: string;
  arrivesAt?: string;
  visibility: PlaneVisibility;
}

/* ─────────────────────────────────────────────
   Bulletin — scrollable list of grouped memories
   ───────────────────────────────────────────── */

/** Generate stable pseudo-random scatter positions for notes */
function scatterPositions(count: number, seed: number = 42) {
  const positions: { x: number; y: number; rotate: number }[] = [];
  let s = seed;
  const rand = () => { s = (s * 16807 + 0) % 2147483647; return (s & 0x7fffffff) / 2147483647; };
  for (let i = 0; i < count; i++) {
    positions.push({
      x: 10 + rand() * 45,   // 10-55% from left (percentage)
      y: 60 + i * 110,        // stack vertically with overlap, new on top visually via zIndex
      rotate: (rand() - 0.5) * 12, // -6 to +6 degrees
    });
  }
  return positions;
}

function BulletinView({
  memories,
  onClose,
  onEcho,
  bottomInset,
}: {
  memories: PlaneMemory[];
  onClose: () => void;
  onEcho: (memory: PlaneMemory) => void;
  bottomInset: number;
}) {
  const insets = useSafeAreaInsets();
  const [openedMemory, setOpenedMemory] = useState<PlaneMemory | null>(null);

  // Reverse so newest = last in array = highest zIndex (on top)
  const reversed = useMemo(() => [...memories].reverse(), [memories]);
  const positions = useMemo(() => scatterPositions(reversed.length), [reversed.length]);

  useEffect(() => {
    if (!openedMemory) return;
    const fresh = memories.find((m) => m.id === openedMemory.id);
    if (fresh) setOpenedMemory(fresh);
  }, [memories, openedMemory?.id]);

  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={[s.corkboard, { paddingTop: insets.top }]}>
        {/* header */}
        <View style={s.corkboardHeader}>
          <Text style={s.corkboardTitle}>
            {openedMemory ? 'unfolded note' : `${memories.length} ${memories.length === 1 ? 'note' : 'notes'} here`}
          </Text>
          <Pressable onPress={openedMemory ? () => setOpenedMemory(null) : onClose} hitSlop={12}>
            <Text style={s.corkboardClose}>{openedMemory ? 'back' : 'close'}</Text>
          </Pressable>
        </View>

        {openedMemory ? (
          <UnfoldedNote memory={openedMemory} onEcho={onEcho} />
        ) : (
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={[
              s.corkboardScroll,
              { minHeight: reversed.length * 110 + 200, paddingBottom: bottomInset + 40 },
            ]}
            showsVerticalScrollIndicator={false}
          >
            {reversed.map((memory, i) => {
              const pos = positions[i];
              const uri = photoUri(memory.photo_base64, memory.photo_mime_type);
              return (
                <Pressable
                  key={memory.id}
                  onPress={() => setOpenedMemory(memory)}
                  style={[
                    s.scatteredNote,
                    {
                      left: `${pos.x}%`,
                      top: pos.y,
                      zIndex: i + 1,
                      transform: [{ rotate: `${pos.rotate}deg` }],
                    },
                  ]}
                >
                  <View style={s.scatteredPin} />
                  <Text style={s.scatteredAuthor}>{memory.author_name || 'someone'}</Text>
                  {pinKindForMemory(memory) === 'directed' ? (
                    <Text style={s.scatteredSent}>to {memory.recipient_name || 'a friend'}</Text>
                  ) : null}
                  {uri ? (
                    <Image source={{ uri }} style={s.scatteredPhoto} resizeMode="cover" />
                  ) : null}
                  <Text style={s.scatteredBody} numberOfLines={4}>{memory.body}</Text>
                  <Text style={s.scatteredTime}>{formatTimestamp(memory.created_at)}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

function UnfoldedNote({
  memory,
  onEcho,
}: {
  memory: PlaneMemory;
  onEcho: (memory: PlaneMemory) => void;
}) {
  const strokes = safeParseStrokes(memory.sketch_json);
  const uri = photoUri(memory.photo_base64, memory.photo_mime_type);

  return (
    <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 24, paddingBottom: 60 }}>
      <View style={s.unfoldedPaper}>
        <View style={s.noteMeta}>
          <Text style={s.noteAuthor}>{memory.author_name || 'someone'}</Text>
          <Text style={s.noteTime}>{formatTimestamp(memory.created_at)}</Text>
        </View>
        {pinKindForMemory(memory) === 'directed' ? (
          <Text style={s.sentMeta}>
            to {memory.recipient_name || 'a friend'}
            {memory.arrives_at ? ` · arrives ${formatTimestamp(memory.arrives_at)}` : ''}
          </Text>
        ) : null}
        <Text style={s.noteBody}>{memory.body}</Text>
        {uri ? (
          <Image source={{ uri }} style={s.notePhoto} resizeMode="cover" />
        ) : null}
        {memory.link_url ? (
          <Text style={s.noteLink}>{memory.link_url}</Text>
        ) : null}
        {strokes.length > 0 ? <MiniSketch strokes={strokes} /> : null}
        {memory.visibility === 'free' && (
          <Pressable onPress={() => onEcho(memory)} style={s.noteEchoWrap}>
            <Text style={[s.noteEcho, memory.echoed_by_me && s.noteEchoActive]}>
              {memory.echoed_by_me ? 'echoed' : 'echo'}
              {memory.echo_count > 0 ? ` \u00b7 ${memory.echo_count}` : ''}
            </Text>
          </Pressable>
        )}
      </View>
    </ScrollView>
  );
}

/* ─────────────────────────────────────────────
   Composer
   ───────────────────────────────────────────── */

function ComposerPanel({
  onClose,
  onSave,
  bottomInset,
}: {
  onClose: () => void;
  onSave: (input: SavePlaneInput) => Promise<void>;
  bottomInset: number;
}) {
  const insets = useSafeAreaInsets();
  const [body, setBody] = useState('');
  const [authorName, setAuthorName] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [showLink, setShowLink] = useState(false);
  const [showSketch, setShowSketch] = useState(false);
  const [strokes, setStrokes] = useState<SketchStroke[]>([]);
  const [photoBase64, setPhotoBase64] = useState<string | null>(null);
  const [photoMimeType, setPhotoMimeType] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const [sendMode, setSendMode] = useState(false);
  const [selectedFriendId, setSelectedFriendId] = useState<(typeof DEMO_FRIENDS)[number]['id']>(DEMO_FRIENDS[0].id);
  const [selectedDelayId, setSelectedDelayId] = useState<(typeof DEMO_DELAYS)[number]['id']>(DEMO_DELAYS[0].id);

  async function pickPhoto() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.5,
      base64: true,
      allowsEditing: true,
    });
    const asset = result.assets?.[0];
    if (!result.canceled && asset?.base64) {
      setPhotoBase64(asset.base64);
      setPhotoMimeType(asset.mimeType ?? 'image/jpeg');
    }
  }

  async function savePlane(
    visibility: PlaneVisibility,
    options: {
      kind?: PlaneKind;
      recipientName?: string;
      arrivesAt?: string;
    } = {},
  ) {
    const cleanBody = body.trim() || (strokes.length ? 'a sketch left here.' : (photoBase64 ? 'a photo left here.' : ''));
    if (!cleanBody) {
      Alert.alert('write, draw, or add a photo first.');
      setReleasing(false);
      return;
    }
    setSaving(true);
    Keyboard.dismiss();
    try {
      await onSave({
        body: cleanBody,
        linkUrl: linkUrl.trim() || undefined,
        sketchJson: JSON.stringify(strokes),
        photoBase64: photoBase64 || undefined,
        photoMimeType: photoMimeType || undefined,
        authorName: authorName.trim() || undefined,
        kind: options.kind,
        recipientName: options.recipientName,
        arrivesAt: options.arrivesAt,
        visibility,
      });
    } catch (error) {
      Alert.alert('could not save.', error instanceof Error ? error.message : undefined);
    } finally {
      setSaving(false);
    }
  }

  function sendToFriend() {
    const friend = DEMO_FRIENDS.find((item) => item.id === selectedFriendId) ?? DEMO_FRIENDS[0];
    const delay = DEMO_DELAYS.find((item) => item.id === selectedDelayId) ?? DEMO_DELAYS[0];
    const arrivesAt = new Date(Date.now() + delay.minutes * 60_000).toISOString();
    savePlane('free', {
      kind: 'directed',
      recipientName: friend.name,
      arrivesAt,
    });
  }

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[s.composerModal, { paddingTop: insets.top + 8, paddingBottom: bottomInset + 20 }]}
      >
        {/* header row */}
        <View style={s.composerHeader}>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={s.composerHeaderText}>close</Text>
          </Pressable>
          <Pressable
            onPress={() => { Keyboard.dismiss(); setReleasing(true); }}
            disabled={saving}
          >
            <Text style={s.releaseText}>done</Text>
          </Pressable>
        </View>

        {!releasing ? (
          <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {/* author name */}
            <TextInput
              style={s.authorInput}
              value={authorName}
              onChangeText={setAuthorName}
              placeholder="your name (optional)"
              placeholderTextColor={C.clay}
              maxLength={100}
            />

            {/* main text input */}
            <TextInput
              style={s.composerInput}
              value={body}
              onChangeText={setBody}
              multiline
              maxLength={500}
              placeholder="leave something here..."
              placeholderTextColor={C.clay}
              autoFocus
            />

            {/* photo preview */}
            {photoBase64 && (
              <View style={s.photoPreviewWrap}>
                <Image
                  source={{ uri: photoUri(photoBase64, photoMimeType)! }}
                  style={s.photoPreview}
                  resizeMode="cover"
                />
                <Pressable
                  onPress={() => {
                    setPhotoBase64(null);
                    setPhotoMimeType(null);
                  }}
                  style={s.photoRemove}
                >
                  <Text style={s.photoRemoveText}>remove</Text>
                </Pressable>
              </View>
            )}

            {/* optional sketch area */}
            {showSketch && <SketchPad strokes={strokes} setStrokes={setStrokes} />}

            {/* optional link */}
            {showLink && (
              <TextInput
                style={s.linkInput}
                value={linkUrl}
                onChangeText={setLinkUrl}
                autoCapitalize="none"
                keyboardType="url"
                placeholder="https://..."
                placeholderTextColor={C.clay}
              />
            )}

            {/* toolbar */}
            <View style={s.composerToolbar}>
              <View style={s.toolbarIcons}>
                <Pressable onPress={pickPhoto} hitSlop={10}>
                  <Text style={[s.toolIcon, photoBase64 ? s.toolIconActive : null]}>photo</Text>
                </Pressable>
                <Pressable onPress={() => setShowSketch(!showSketch)} hitSlop={10}>
                  <Text style={[s.toolIcon, showSketch && s.toolIconActive]}>pencil</Text>
                </Pressable>
                <Pressable onPress={() => setShowLink(!showLink)} hitSlop={10}>
                  <Text style={[s.toolIcon, showLink && s.toolIconActive]}>link</Text>
                </Pressable>
                {showSketch && strokes.length > 0 && (
                  <Pressable onPress={() => setStrokes([])} hitSlop={10}>
                    <Text style={s.toolIconClear}>clear</Text>
                  </Pressable>
                )}
              </View>
            </View>
          </ScrollView>
        ) : (
          <View style={s.releasePanel}>
            <Text style={s.releaseQuestion}>what would you like{'\n'}to do with this?</Text>

            {!sendMode ? (
              <>
            <Pressable disabled={saving} onPress={() => savePlane('folded', { kind: 'private' })} style={s.releaseBtnRow}>
              <Image source={scrunchedImg} style={s.releaseBtnImg} resizeMode="contain" />
              <View style={s.releaseBtnText}>
                <Text style={s.releaseBtnTitle}>keep it folded</Text>
                <Text style={s.releaseBtnSub}>just for you</Text>
              </View>
            </Pressable>

            <Pressable disabled={saving} onPress={() => savePlane('free', { kind: 'public' })} style={s.releaseBtnRow}>
              <Image source={paperOpenImg} style={s.releaseBtnImg} resizeMode="contain" />
              <View style={s.releaseBtnText}>
                <Text style={s.releaseBtnTitle}>set it free</Text>
                <Text style={s.releaseBtnSub}>for whoever finds it</Text>
              </View>
            </Pressable>

            <Pressable disabled={saving} onPress={() => setSendMode(true)} style={s.releaseBtnRow}>
              <Image source={paperplanePin} style={s.releaseBtnImg} resizeMode="contain" />
              <View style={s.releaseBtnText}>
                <Text style={s.releaseBtnTitle}>send to someone</Text>
                <Text style={s.releaseBtnSub}>lands for a friend later</Text>
              </View>
            </Pressable>
              </>
            ) : (
              <View style={s.sendPanel}>
                <Text style={s.sendLabel}>who should catch it?</Text>
                <View style={s.chipRow}>
                  {DEMO_FRIENDS.map((friend) => (
                    <Pressable
                      key={friend.id}
                      onPress={() => setSelectedFriendId(friend.id)}
                      style={[s.choiceChip, selectedFriendId === friend.id && s.choiceChipActive]}
                    >
                      <Text style={[s.choiceChipText, selectedFriendId === friend.id && s.choiceChipTextActive]}>
                        {friend.name}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                <Text style={s.sendLabel}>when should it arrive?</Text>
                <View style={s.chipRow}>
                  {DEMO_DELAYS.map((delay) => (
                    <Pressable
                      key={delay.id}
                      onPress={() => setSelectedDelayId(delay.id)}
                      style={[s.choiceChip, selectedDelayId === delay.id && s.choiceChipActive]}
                    >
                      <Text style={[s.choiceChipText, selectedDelayId === delay.id && s.choiceChipTextActive]}>
                        {delay.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                <Pressable disabled={saving} onPress={sendToFriend} style={s.releaseBtnRow}>
                  <Image source={paperplanePin} style={s.releaseBtnImg} resizeMode="contain" />
                  <View style={s.releaseBtnText}>
                    <Text style={s.releaseBtnTitle}>send plane</Text>
                    <Text style={s.releaseBtnSub}>it will draw a flight path</Text>
                  </View>
                </Pressable>
              </View>
            )}

            <Pressable onPress={() => sendMode ? setSendMode(false) : setReleasing(false)} disabled={saving}>
              <Text style={s.backToEdit}>{sendMode ? 'back' : 'keep writing'}</Text>
            </Pressable>
          </View>
        )}
      </KeyboardAvoidingView>
    </Modal>
  );
}

/* ─────────────────────────────────────────────
   Sketch pad
   ───────────────────────────────────────────── */

function SketchPad({
  strokes,
  setStrokes,
}: {
  strokes: SketchStroke[];
  setStrokes: (strokes: SketchStroke[]) => void;
}) {
  const currentStroke = useRef<SketchStroke | null>(null);
  const [size, setSize] = useState({ width: 1, height: 1 });

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (event) => {
          const { locationX, locationY } = event.nativeEvent;
          currentStroke.current = {
            id: `${Date.now()}`,
            points: [{ x: locationX, y: locationY }],
          };
          setStrokes([...strokes, currentStroke.current]);
        },
        onPanResponderMove: (event) => {
          if (!currentStroke.current) return;
          const { locationX, locationY } = event.nativeEvent;
          currentStroke.current = {
            ...currentStroke.current,
            points: [...currentStroke.current.points, { x: locationX, y: locationY }],
          };
          setStrokes([
            ...strokes.filter((st) => st.id !== currentStroke.current?.id),
            currentStroke.current,
          ]);
        },
        onPanResponderRelease: () => {
          currentStroke.current = null;
        },
      }),
    [setStrokes, strokes],
  );

  return (
    <View
      style={s.sketchPad}
      onLayout={(e) => setSize(e.nativeEvent.layout)}
      {...responder.panHandlers}
    >
      <Svg width={size.width} height={size.height}>
        {strokes.map((stroke) => (
          <Polyline
            key={stroke.id}
            points={stroke.points.map((p) => `${p.x},${p.y}`).join(' ')}
            fill="none"
            stroke={C.sketchStroke}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </Svg>
    </View>
  );
}

/* ─────────────────────────────────────────────
   Mini sketch preview
   ───────────────────────────────────────────── */

function MiniSketch({ strokes }: { strokes: SketchStroke[] }) {
  return (
    <View style={s.miniSketch}>
      <Svg width="100%" height="100%" viewBox="0 0 320 200">
        {strokes.map((stroke) => (
          <Polyline
            key={stroke.id}
            points={stroke.points.map((p) => `${p.x},${p.y}`).join(' ')}
            fill="none"
            stroke={C.sketchStroke}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </Svg>
    </View>
  );
}

function safeParseStrokes(value: string): SketchStroke[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/* ─────────────────────────────────────────────
   Styles
   ───────────────────────────────────────────── */

const s = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: C.milk,
  },

  /* ── header ── */
  header: {
    position: 'absolute',
    left: 24,
    top: 0,
  },
  appName: {
    fontFamily: SERIF,
    fontSize: 32,
    fontWeight: '300',
    color: C.walnut,
    letterSpacing: 1,
    opacity: 0.7,
  },
  subtitle: {
    fontFamily: SERIF,
    fontSize: 13,
    color: C.clay,
    marginTop: 2,
    fontStyle: 'italic',
  },
  subtitleSep: {
    color: C.clay,
  },

  /* ── pins ── */
  pinImage: {
    width: 40,
    height: 40,
    opacity: 0.8,
  },
  markerPlane: {
    width: 36,
    height: 36,
    opacity: 0.75,
  },

  /* ── compose button ── */
  composeButtonWrap: {
    position: 'absolute',
    bottom: 0,
    alignSelf: 'center',
    alignItems: 'center',
  },
  composeButtonPlane: {
    width: 52,
    height: 52,
    opacity: 0.6,
  },
  composeHint: {
    fontFamily: SERIF,
    fontSize: 12,
    color: C.clay,
    fontStyle: 'italic',
    marginTop: 4,
    opacity: 0.7,
  },

  /* ── pin drop mode ── */
  pinDropUI: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  pinDropHint: {
    fontFamily: SERIF,
    fontSize: 15,
    color: C.walnut,
    fontStyle: 'italic',
    marginBottom: 16,
    opacity: 0.7,
  },
  pinDropActions: {
    flexDirection: 'row',
    gap: 24,
    alignItems: 'center',
  },
  pinDropCancel: {
    fontFamily: SERIF,
    fontSize: 15,
    color: C.clay,
    fontStyle: 'italic',
  },
  pinDropConfirm: {
    backgroundColor: C.terracotta,
    borderRadius: 20,
    paddingHorizontal: 24,
    paddingVertical: 10,
  },
  pinDropConfirmText: {
    fontFamily: SERIF,
    fontSize: 15,
    color: C.milk,
    fontStyle: 'italic',
  },

  /* ── loading ── */
  loading: {
    position: 'absolute',
    top: '45%',
    alignSelf: 'center',
    alignItems: 'center',
    gap: 8,
  },
  loadingText: {
    fontFamily: SERIF,
    fontSize: 13,
    color: C.clay,
    fontStyle: 'italic',
  },

  /* ── corkboard modal ── */
  corkboard: {
    flex: 1,
    backgroundColor: C.milk,
  },
  corkboardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 14,
  },
  corkboardTitle: {
    fontFamily: SERIF,
    fontSize: 15,
    color: C.clay,
    fontStyle: 'italic',
  },
  corkboardClose: {
    fontFamily: SERIF,
    fontSize: 15,
    color: C.clay,
    fontStyle: 'italic',
  },
  corkboardScroll: {
    position: 'relative',
  },

  /* ── scattered note ── */
  scatteredNote: {
    position: 'absolute',
    width: '48%',
    minHeight: 120,
    borderRadius: 4,
    backgroundColor: 'rgba(255, 253, 248, 0.95)',
    padding: 14,
    paddingTop: 18,
    shadowColor: C.walnut,
    shadowOffset: { width: 1, height: 3 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  scatteredPin: {
    position: 'absolute',
    top: 6,
    alignSelf: 'center',
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: C.terracottaFaded,
  },
  scatteredAuthor: {
    fontFamily: SERIF,
    fontSize: 12,
    color: C.terracotta,
    fontStyle: 'italic',
    marginBottom: 4,
  },
  scatteredSent: {
    fontFamily: SERIF,
    fontSize: 11,
    color: C.clay,
    fontStyle: 'italic',
    marginBottom: 5,
  },
  scatteredPhoto: {
    width: '100%',
    height: 70,
    borderRadius: 4,
    marginBottom: 6,
  },
  scatteredBody: {
    fontFamily: SERIF,
    fontSize: 14,
    lineHeight: 20,
    color: C.walnut,
  },
  scatteredTime: {
    fontFamily: SERIF,
    fontSize: 10,
    color: C.clay,
    fontStyle: 'italic',
    marginTop: 6,
  },

  /* ── unfolded note detail ── */
  unfoldedPaper: {
    borderRadius: 8,
    backgroundColor: 'rgba(255, 253, 248, 0.95)',
    padding: 20,
  },

  /* ── note item (inside bulletin) ── */
  noteItem: {
    paddingVertical: 14,
  },
  noteItemBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.line,
  },
  noteMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  noteAuthor: {
    fontFamily: SERIF,
    fontSize: 13,
    color: C.terracotta,
    fontStyle: 'italic',
  },
  noteTime: {
    fontFamily: SERIF,
    fontSize: 11,
    color: C.clay,
    fontStyle: 'italic',
  },
  noteBody: {
    fontFamily: SERIF,
    fontSize: 16,
    lineHeight: 23,
    color: C.walnut,
  },
  sentMeta: {
    fontFamily: SERIF,
    fontSize: 12,
    color: C.terracotta,
    fontStyle: 'italic',
    marginBottom: 10,
  },
  notePhoto: {
    width: '100%',
    height: 180,
    borderRadius: 12,
    marginTop: 10,
  },
  noteLink: {
    fontFamily: SERIF,
    fontSize: 13,
    color: C.terracotta,
    fontStyle: 'italic',
    marginTop: 6,
  },
  noteEchoWrap: {
    marginTop: 8,
  },
  noteEcho: {
    fontFamily: SERIF,
    fontSize: 13,
    color: C.clay,
    fontStyle: 'italic',
  },
  noteEchoActive: {
    color: C.terracotta,
  },

  /* ── composer modal ── */
  composerModal: {
    flex: 1,
    backgroundColor: C.milk,
    paddingHorizontal: 24,
  },
  composerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
  },
  composerHeaderText: {
    fontFamily: SERIF,
    fontSize: 15,
    color: C.clay,
    fontStyle: 'italic',
  },
  authorInput: {
    fontFamily: SERIF,
    fontSize: 14,
    color: C.terracotta,
    fontStyle: 'italic',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.line,
    paddingVertical: 10,
    marginBottom: 16,
  },
  composerInput: {
    fontFamily: SERIF,
    fontSize: 20,
    lineHeight: 30,
    color: C.walnut,
    minHeight: 120,
    textAlignVertical: 'top',
    padding: 0,
  },
  photoPreviewWrap: {
    marginTop: 16,
    borderRadius: 12,
    overflow: 'hidden',
  },
  photoPreview: {
    width: '100%',
    height: 200,
    borderRadius: 12,
  },
  photoRemove: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  photoRemoveText: {
    fontFamily: SERIF,
    fontSize: 12,
    color: '#fff',
    fontStyle: 'italic',
  },
  linkInput: {
    fontFamily: SERIF,
    fontSize: 15,
    color: C.walnut,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.line,
    paddingVertical: 8,
    marginTop: 16,
  },
  composerToolbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 16,
    paddingBottom: 4,
  },
  toolbarIcons: {
    flexDirection: 'row',
    gap: 18,
  },
  toolIcon: {
    fontFamily: SERIF,
    fontSize: 13,
    color: C.clay,
    fontStyle: 'italic',
  },
  toolIconActive: {
    color: C.terracotta,
  },
  toolIconClear: {
    fontFamily: SERIF,
    fontSize: 13,
    color: C.clay,
    fontStyle: 'italic',
    opacity: 0.6,
  },
  releaseText: {
    fontFamily: SERIF,
    fontSize: 15,
    color: C.terracotta,
    fontStyle: 'italic',
  },

  /* ── release choice ── */
  releasePanel: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 8,
    gap: 12,
  },
  releaseQuestion: {
    fontFamily: SERIF,
    fontSize: 24,
    color: C.walnut,
    lineHeight: 34,
    marginBottom: 28,
  },
  sendPanel: {
    gap: 14,
  },
  sendLabel: {
    fontFamily: SERIF,
    fontSize: 13,
    color: C.clay,
    fontStyle: 'italic',
    marginTop: 4,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  choiceChip: {
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.line,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: C.cream,
  },
  choiceChipActive: {
    backgroundColor: C.terracotta,
    borderColor: C.terracotta,
  },
  choiceChipText: {
    fontFamily: SERIF,
    fontSize: 13,
    color: C.walnut,
    fontStyle: 'italic',
  },
  choiceChipTextActive: {
    color: C.milk,
  },
  releaseBtnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
    paddingVertical: 16,
    paddingHorizontal: 8,
    borderRadius: 14,
  },
  releaseBtnImg: {
    width: 64,
    height: 64,
  },
  releaseBtnText: {
    flex: 1,
  },
  releaseBtnTitle: {
    fontFamily: SERIF,
    fontSize: 19,
    color: C.walnut,
  },
  releaseBtnSub: {
    fontFamily: SERIF,
    fontSize: 13,
    color: C.clay,
    fontStyle: 'italic',
    marginTop: 3,
  },
  backToEdit: {
    fontFamily: SERIF,
    fontSize: 13,
    color: C.clay,
    fontStyle: 'italic',
    marginTop: 24,
    textAlign: 'center',
  },

  /* ── sketch pad ── */
  sketchPad: {
    height: 200,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 253, 248, 0.5)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.line,
    overflow: 'hidden',
    marginTop: 16,
  },

  /* ── mini sketch ── */
  miniSketch: {
    height: 120,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 253, 248, 0.4)',
    marginTop: 10,
    overflow: 'hidden',
  },
});
