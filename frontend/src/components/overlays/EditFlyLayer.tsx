import type { EditFlyItem } from './overlayTypes.ts';

interface EditFlyLayerProps {
  editFlyAnimation: { items: EditFlyItem[] };
}

/** 编辑/添加/保存服务器时的飞行动画层（items 分支渲染由 App.tsx 组装产生） */
export default function EditFlyLayer({ editFlyAnimation }: EditFlyLayerProps) {
  return (
    <div className="edit-fly-layer" aria-hidden="true">
      {editFlyAnimation.items.map((item) => (
        item.type === 'beam' ? (
          <div
            key={item.id}
            className={`edit-fly-beam edit-fly-beam-${item.field}`}
            style={{
              '--beam-from-x': `${item.from.x}px`,
              '--beam-from-y': `${item.from.y}px`,
              '--beam-length': item.length,
              '--beam-angle': item.angle,
              '--beam-delay': `${item.delay}ms`,
            } as React.CSSProperties}
          />
        ) : item.type === 'add-core' ? (
          <div
            key={item.id}
            className="add-supernova-core"
            style={{
              '--add-path': item.path,
              '--add-delay': `${item.delay}ms`,
            } as React.CSSProperties}
          />
        ) : item.type === 'add-particle' ? (
          <div
            key={item.id}
            className="add-supernova-particle"
            style={{
              '--particle-path': item.path,
              '--particle-size': `${item.size}px`,
              '--particle-delay': `${item.delay}ms`,
            } as React.CSSProperties}
          />
        ) : item.type === 'add-ring' ? (
          <div
            key={item.id}
            className="add-supernova-ring"
            style={{
              '--ring-x': `${item.at.x}px`,
              '--ring-y': `${item.at.y}px`,
              '--ring-delay': `${item.delay}ms`,
            } as React.CSSProperties}
          />
        ) : item.type === 'save-flow-capsule' ? (
          <div
            key={item.id}
            className={`save-flow-capsule save-flow-capsule-${item.field}`}
            style={{
              '--save-flow-from-x': `${item.from.x}px`,
              '--save-flow-from-y': `${item.from.y}px`,
              '--save-flow-mid-x': `${item.mid.x}px`,
              '--save-flow-mid-y': `${item.mid.y}px`,
              '--save-flow-to-x': `${item.to.x}px`,
              '--save-flow-to-y': `${item.to.y}px`,
              '--save-flow-delay': `${item.delay}ms`,
            } as React.CSSProperties}
          >
            <span className="edit-fly-label">{item.label}</span>
            {item.value ? <span className="edit-fly-value">{item.value}</span> : null}
          </div>
        ) : (
          <div
            key={item.id}
            className={`edit-fly-capsule edit-fly-capsule-${item.field}`}
            style={{
              '--fly-from-x': `${item.from.x}px`,
              '--fly-from-y': `${item.from.y}px`,
              '--fly-mid-x': `${item.mid.x}px`,
              '--fly-mid-y': `${item.mid.y}px`,
              '--fly-to-x': `${item.to.x}px`,
              '--fly-to-y': `${item.to.y}px`,
              '--fly-delay': `${item.delay}ms`,
            } as React.CSSProperties}
          >
            <span className="edit-fly-label">{item.label}</span>
            {item.value ? <span className="edit-fly-value">{item.value}</span> : null}
          </div>
        )
      ))}
    </div>
  );
}
