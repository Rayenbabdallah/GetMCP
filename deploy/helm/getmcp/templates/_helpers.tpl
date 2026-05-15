{{/* Common name helpers */}}
{{- define "getmcp.fullname" -}}
{{- printf "%s" .Release.Name -}}
{{- end -}}

{{- define "getmcp.api.name" -}}
{{- printf "%s-api" .Release.Name -}}
{{- end -}}

{{- define "getmcp.web.name" -}}
{{- printf "%s-web" .Release.Name -}}
{{- end -}}

{{/* Standard labels */}}
{{- define "getmcp.labels" -}}
app.kubernetes.io/name: {{ .Chart.Name }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
{{- end -}}

{{/* Common env vars for the API container */}}
{{- define "getmcp.api.env" -}}
- name: DATABASE_URL
  valueFrom:
    secretKeyRef:
      name: {{ .Values.database.existingSecret }}
      key: {{ .Values.database.secretKey }}
- name: KEY_ENCRYPTION_KEY
  valueFrom:
    secretKeyRef:
      name: {{ .Values.encryptionKey.existingSecret }}
      key: {{ .Values.encryptionKey.secretKey }}
{{- if .Values.anthropic.existingSecret }}
- name: ANTHROPIC_API_KEY
  valueFrom:
    secretKeyRef:
      name: {{ .Values.anthropic.existingSecret }}
      key: {{ .Values.anthropic.secretKey }}
{{- end }}
- name: NODE_ENV
  value: {{ .Values.api.env.NODE_ENV | quote }}
- name: LOG_LEVEL
  value: {{ .Values.api.env.LOG_LEVEL | quote }}
- name: PORT
  value: {{ .Values.api.service.port | quote }}
- name: CORS_ORIGINS
  value: {{ .Values.api.corsOrigins | quote }}
- name: JSON_BODY_LIMIT
  value: {{ .Values.api.jsonBodyLimit | quote }}
{{- end -}}
