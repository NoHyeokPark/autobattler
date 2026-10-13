// 카드 일러스트 파일 규칙. 이미지는 프로젝트의 art/ 폴더에 파일로 둔다 (data URL을 쓰지 않는다).
//
//   art/monsters/<id>.png                 Lv1 (기본)
//   art/monsters/<id>.lv2.png             Lv2 기본 형태
//   art/monsters/<id>.lv2.<성장 id>.png   Lv2, 외형 변화 성장(form)을 고른 형태
//   art/monsters/<id>.lv3.<성장 id>.png   Lv3, 그 형태로 진화
//   art/leaders/<id>.lv<레벨>[.<성장 id>].png   (리더는 Lv1~5, 마지막으로 고른 외형 변화 성장이 형태)
//   art/trinkets/<id>.png
//
// 확장자는 webp·png·jpg·jpeg·gif·avif 중 아무거나. 파일이 없으면 가까운 것으로 대신한다:
//   같은 형태의 낮은 레벨 → 기본 형태의 같은/낮은 레벨 → Lv1 → (없으면 글자 카드)
// 이 파일은 다른 게임 데이터를 import하지 않는다 (Vite 설정의 art 플러그인이 가져다 쓰므로).

export type ArtKind = 'monsters' | 'leaders' | 'trinkets';

export interface ArtRef {
  kind: ArtKind;
  id: string;
  level?: number;
  form?: string; // 외형 변화 성장 id
}

// 파일 키(폴더/이름, 확장자 제외)
export function artKey(ref: ArtRef): string {
  const lv = ref.level && ref.level > 1 ? `.lv${ref.level}` : '';
  const form = ref.form && ref.level && ref.level > 1 ? `.${ref.form}` : '';
  return `${ref.kind}/${ref.id}${lv}${form}`;
}

// 이 카드에 쓸 이미지 후보 (앞에서부터 있는 것을 쓴다)
export function artCandidates(ref: ArtRef): string[] {
  const out: string[] = [];
  const level = ref.level ?? 1;
  if (ref.form) for (let l = level; l >= 2; l--) out.push(artKey({ ...ref, level: l }));
  for (let l = level; l >= 2; l--) out.push(artKey({ kind: ref.kind, id: ref.id, level: l }));
  out.push(artKey({ kind: ref.kind, id: ref.id }));
  return [...new Set(out)];
}

// 업로드·저장 시 허용하는 키 (경로 조작 방지)
export const ART_KEY_RE = /^(monsters|leaders|trinkets)\/[A-Za-z0-9_-]+(\.lv\d+)?(\.[A-Za-z0-9_-]+)?$/;
export const ART_EXTS = ['.webp', '.png', '.jpg', '.jpeg', '.gif', '.avif'];
