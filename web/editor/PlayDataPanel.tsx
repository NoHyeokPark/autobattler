// 플레이 데이터 정리: PvP 기록 풀(saves/records.json), 리더 기록(saves/profile.json), 진행 중인 런(saves/web-run.json).
// 예전 규칙 버전·다른 모드·재현할 수 없는 기록이 쌓이면 골라서 지운다. 지우기 전에 개발 서버가 saves/backup/에 백업한다.

import { useEffect, useReducer, useState } from 'react';
import { activeModName } from '../../src/data/activeMod.ts';
import type { RecordGroup } from '../lib/persist.ts';
import { deleteProfile, deleteRecords, deleteRun, hasSave, onSavesChanged, recordStats, SAVE_PATHS, storageMode } from '../lib/persist.ts';

export function PlayDataPanel() {
  const [, force] = useReducer((x: number) => x + 1, 0);
  const [msg, setMsg] = useState('');
  useEffect(() => onSavesChanged(force), []);
  const mod = activeModName();
  const st = recordStats(mod);
  const project = storageMode() === 'project';
  const backupNote = project ? ' 지우기 전 파일은 saves/backup/에 백업됩니다.' : '';

  const del = (groups: RecordGroup[] | 'all', what: string, n: number) => {
    if (n <= 0 || !confirm(`${what} ${n}개를 지울까요?${backupNote}`)) return;
    const removed = deleteRecords(mod, groups);
    setMsg(`${what} ${removed}개를 지웠습니다.`);
    force();
  };
  const row = (label: string, n: number, hint: string, groups: RecordGroup[] | null) => (
    <tr>
      <td>{label}</td>
      <td className="num">{n}</td>
      <td className="muted small">{hint}</td>
      <td>{groups && <button className="btn tiny danger" disabled={n === 0} onClick={() => del(groups, label, n)}>지우기</button>}</td>
    </tr>
  );

  return (
    <div className="mod-panel">
      <section className="panel">
        <h3>저장 위치</h3>
        <p className="muted">
          {project ? '프로젝트 폴더의 파일에 저장됩니다.' : '개발 서버 없이 열려 있어 브라우저 저장소에 있습니다.'}{' '}
          PvP 기록 <code>{SAVE_PATHS.records}</code> · 리더 기록 <code>{SAVE_PATHS.profile}</code> · 진행 중인 런 <code>{SAVE_PATHS.run}</code>
          {' '}(터미널 버전의 런은 <code>saves/run.json</code>)
        </p>
      </section>

      <section className="panel">
        <h3>PvP 기록 풀 <span className="muted small">전체 {st.total}개 · 적용 중인 모드 "{mod}" 기준</span></h3>
        <table className="table play-data">
          <thead><tr><th>분류</th><th className="num">개수</th><th>설명</th><th /></tr></thead>
          <tbody>
            {row('이 모드에서 쓰는 기록', st.usable, '지금 매칭에 쓰입니다', ['usable'])}
            {row('모드 표시 없는 예전 기록', st.legacy, '모드 이름을 기록하기 전에 만든 것. 모든 모드에서 매칭에 쓰입니다', ['legacy'])}
            {row('예전 규칙 버전', st.old, '규칙이 바뀌기 전에 만든 기록. 매칭에 쓰이지 않습니다', ['old'])}
            {row('재현할 수 없는 기록', st.broken, '이 모드에서 지운 유닛·장신구가 들어 있음. 매칭에 쓰이지 않습니다', ['broken'])}
            {st.byMod.map(([name, n]) => row(`다른 모드: ${name}`, n, '그 모드를 적용했을 때만 쓰입니다', [`mod:${name}`]))}
          </tbody>
        </table>
        <div className="inline wrap">
          <button className="btn" disabled={st.old + st.broken === 0} onClick={() => del(['old', 'broken'], '쓰이지 않는 기록(예전 버전·재현 불가)', st.old + st.broken)}>
            쓰이지 않는 기록 정리
          </button>
          <button className="btn danger" disabled={st.total === 0} onClick={() => del('all', '모든 PvP 기록', st.total)}>모든 기록 삭제</button>
        </div>
      </section>

      <section className="panel">
        <h3>리더 기록 · 진행 중인 런</h3>
        <p className="muted">리더별 판수·우승·최고 기록과 자주 쓴 조합(리더 선택 화면에 보이는 것), 그리고 이어서 하던 런입니다.</p>
        <div className="inline wrap">
          <button className="btn danger" disabled={!hasSave('profile')} onClick={() => {
            if (!confirm(`리더 기록을 모두 지울까요?${backupNote}`)) return;
            deleteProfile();
            setMsg('리더 기록을 지웠습니다.');
          }}>리더 기록 초기화</button>
          <button className="btn danger" disabled={!hasSave('run')} onClick={() => {
            if (!confirm(`진행 중인 런을 지울까요? 게임 탭의 런도 사라집니다.${backupNote}`)) return;
            deleteRun();
            setMsg('진행 중인 런을 지웠습니다.');
          }}>진행 중인 런 삭제</button>
        </div>
      </section>
      {msg && <p className="ok-text">{msg}</p>}
    </div>
  );
}
