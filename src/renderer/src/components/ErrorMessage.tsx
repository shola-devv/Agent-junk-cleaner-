interface ErrorMessageProps {
  title: string
  message: string
  onDismiss?: () => void
}

function ErrorMessage({ title, message, onDismiss }: ErrorMessageProps): React.JSX.Element {
  return (
    <div className="error-message" role="alert">
      <span className="error-symbol" aria-hidden="true">
        !
      </span>
      <div>
        <strong>{title}</strong>
        <p>{message}</p>
      </div>
      {onDismiss && (
        <button
          className="icon-button error-dismiss"
          onClick={onDismiss}
          aria-label="Dismiss error"
        >
          ×
        </button>
      )}
    </div>
  )
}

export default ErrorMessage
