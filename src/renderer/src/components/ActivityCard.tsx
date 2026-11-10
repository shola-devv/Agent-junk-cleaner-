interface ActivityCardProps {
  title: string
  detail: string
  status?: 'ready' | 'running' | 'complete'
}

function ActivityCard({ title, detail, status = 'ready' }: ActivityCardProps): React.JSX.Element {
  return (
    <div className={`activity-card activity-${status}`}>
      <span className="activity-mark" aria-hidden="true">
        {status === 'complete' ? '✓' : status === 'running' ? '◌' : '◇'}
      </span>
      <div>
        <strong>{title}</strong>
        <p>{detail}</p>
      </div>
      <span className="activity-state">{status}</span>
    </div>
  )
}

export default ActivityCard
