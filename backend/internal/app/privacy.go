package app

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/mail"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

const privacyTemplate = "ru-2026-10-v3"

type Operator struct {
	Kind         string `json:"kind"`
	LegalName    string `json:"legal_name"`
	INN          string `json:"inn"`
	Registration string `json:"registration"`
	Address      string `json:"address"`
	Contact      string `json:"contact"`
	Contractors  string `json:"contractors"`
	Locations    string `json:"locations"`
	StaffBasis   string `json:"staff_basis"`
	Approved     bool   `json:"approved"`
	Telegram     bool   `json:"telegram_notifications,omitempty"`
}
type PrivacyDocument struct {
	ID              int64     `json:"id"`
	Template        string    `json:"template_version"`
	Operator        Operator  `json:"operator"`
	Policy          string    `json:"policy"`
	Consent         string    `json:"consent"`
	TelegramConsent string    `json:"telegram_consent"`
	PublishedAt     time.Time `json:"published_at"`
}
type PrivacyChoice struct {
	NoticeVersion  int64 `json:"notice_version"`
	ConsentVersion int64 `json:"consent_version"`
	Accepted       bool  `json:"accepted"`
}
type PrivacyState struct {
	Draft                  Operator         `json:"draft"`
	Revision               int64            `json:"revision"`
	Current                *PrivacyDocument `json:"current"`
	RetentionEnabled       bool             `json:"retention_enabled"`
	LastMaintenance        *time.Time       `json:"last_maintenance_at"`
	PreviewPolicy          string           `json:"preview_policy"`
	PreviewConsent         string           `json:"preview_consent"`
	PreviewTelegramConsent string           `json:"preview_telegram_consent"`
}

func (o Operator) validate(publish bool) error {
	for _, v := range []string{o.Kind, o.LegalName, o.INN, o.Registration, o.Address, o.Contact, o.Contractors, o.Locations, o.StaffBasis} {
		if !utf8.ValidString(v) || utf8.RuneCountInString(v) > 3000 {
			return problem(400, "Поле слишком длинное.")
		}
	}
	if !publish {
		return nil
	}
	if o.Kind != "company" && o.Kind != "ip" {
		return problem(400, "Выберите ООО/организацию или ИП.")
	}
	for _, v := range []string{o.LegalName, o.INN, o.Registration, o.Address, o.Contact, o.Contractors, o.Locations, o.StaffBasis} {
		if strings.TrimSpace(v) == "" {
			return problem(400, "Заполните все реквизиты, получателей, места обработки и основание обработки данных сотрудников.")
		}
	}
	digits := func(v string, n int) bool {
		if len(v) != n {
			return false
		}
		for _, c := range v {
			if c < '0' || c > '9' {
				return false
			}
		}
		return true
	}
	if o.Kind == "ip" && (!digits(o.INN, 12) || !digits(o.Registration, 15)) || o.Kind == "company" && (!digits(o.INN, 10) || !digits(o.Registration, 13)) {
		return problem(400, "Проверьте длину ИНН и ОГРН/ОГРНИП.")
	}
	if address, e := mail.ParseAddress(o.Contact); e != nil || address.Address != o.Contact {
		return problem(400, "Укажите email для обращений о персональных данных.")
	}
	if !o.Approved {
		return problem(400, "Оператор должен утвердить тексты, сроки и основания обработки.")
	}
	return nil
}

func privacyTexts(o Operator) (string, string) {
	identity := fmt.Sprintf("Оператор: %s. ИНН %s, ОГРН/ОГРНИП %s. Адрес: %s. Контакт по персональным данным: %s.", o.LegalName, o.INN, o.Registration, o.Address, o.Contact)
	policy := identity + `\n\n1. Заказ и получение\nСервис принимает гостевые заказы с оплатой при получении. Для исполнения договора обрабатываются состав, стоимость, точка выдачи, номер, время и статус заказа, технические ключи повтора и личной ссылки. Получение возможно только по номеру: имя и комментарий не обязательны. Основание необходимой обработки — исполнение договора (п. 5 ч. 1 ст. 6 152-ФЗ).\n\n2. Необязательные данные\nИмя для выдачи и предпочтения по приготовлению обрабатываются только по отдельному согласию. Не указывайте сведения о здоровье, платёжные данные или данные других людей. Специальные категории данных не запрашиваются. Отказ от согласия не мешает заказу по номеру.\n\n3. Получатели и места обработки\nДоступ имеют только уполномоченные сотрудники в пределах обязанностей. Обработчики и услуги: ` + o.Contractors + `. Места обработки, хранения, журналов и резервных копий: ` + o.Locations + `. Поручения обработчикам и правовые основания утверждает оператор. Продажа данных, реклама, доставка, SMS и онлайн-оплата в сервисе не предусмотрены.\n\n4. Сроки\nИмя, комментарий и свободный текст отмены удаляются через семь дней после закрытия заказа; до закрытия нужны для исполнения. Индивидуальная квитанция, личная ссылка, состав, сумма и события хранятся один год после закрытия, затем удаляются; остаются сводные показатели без идентификаторов гостей. У старых заказов срок отсчитывается от исторического времени обновления; это не измерение приготовления. Минимальные доказательства согласия и обработки обращений хранятся отдельно три года для защиты прав, по утверждённой оператором политике. Минимальные технические метки истёкших ключей предотвращают повторное создание заказа и не содержат его состава или персональных полей. Счётчики безопасности очищаются в пределах 24 часов, рабочий аудит — через год. Контактные и отображаемые данные отключённых сотрудников удаляются через 90 дней; ссылки на действия остаются обезличенными.\n\n5. Cookies и браузер\nДля входа сотрудников используются необходимые защищённые HttpOnly-cookies: короткая сессия до 12 часов и подтверждение одобренного устройства до одного года. Общий вход кухни запоминается на 30 дней от входа, без продления этого срока при обновлении сессии. Для безопасности и контроля уведомлений сохраняются заданная метка устройства, привязка к точке, версия приложения, время связи и техническое состояние оповещений; отпечатки оборудования и браузера не собираются. В Android-приложении ограниченный ключ уведомлений защищён Android Keystore. Общая учётная запись и устройство не устанавливают личность сотрудника, выполнившего действие. Корзины, выбранная точка и личные ссылки истории сохраняются в этом браузере; незавершённая отправка — в хранилище вкладки до результата. Их можно удалить настройками браузера. Удаление истории лишает доступа к личным ссылкам и не удаляет записи оператора. Внешние рекламные/аналитические cookies не устанавливаются приложением. Хостинг может обрабатывать технические сведения подключения в пределах своего поручения.\n\n6. Права и обращения\nПо указанному контакту можно запросить доступ, уточнение, блокирование спорных данных, отзыв согласия и удаление. Сообщите номер/дату/точку заказа и способ обратной связи. Оператор соразмерно проверяет принадлежность данных (например, личная ссылка вместе с деталями покупки или проверка на месте), не запрашивая загрузку паспорта в сервис. Личная ссылка сама по себе не открывает имя и комментарий. Отзыв согласия удаляет необязательные поля и не отменяет заказ. Законные обязанности по другим основаниям могут сохраняться; оператор сообщает решение и применимые сроки. Обращения не используются для маркетинга.\n\n7. Сотрудники, безопасность и копии\nОснование обработки данных сотрудников: ` + o.StaffBasis + `. Пароли хранятся в виде стойких хешей; доступ ограничен ролями и точками, операции фиксируются без паролей и токенов. Резервные копии ограничены уполномоченными лицами, хранятся не более 14 дней; ранее удалённые данные могут оставаться в закрытой копии до её истечения. Перед восстановлением доступа журнал удаления применяется повторно и просроченные данные очищаются. Бухгалтерские и обязательные кадровые архивы ведутся отдельно от этого сервиса.\n\nВерсия шаблона: ` + privacyTemplate + `. Дата и номер публикации приведены на странице. Это политика обработки, а не сертификат соответствия.`
	consent := identity + `\n\nОтдельное согласие на необязательные данные\nЯ добровольно разрешаю оператору обработать введённые мной имя и комментарий к приготовлению только для обращения при выдаче и учёта моих предпочтений по этому заказу. Разрешённые действия: сбор, запись, хранение, использование, уточнение, блокирование и удаление в автоматизированной системе, с доступом уполномоченных сотрудников и обработчиков: ` + o.Contractors + `. Места обработки: ` + o.Locations + `.\n\nНе сообщаю сведения о здоровье, платёжные сведения и чужие персональные данные. Необязательные поля удаляются через семь дней после закрытия заказа или раньше при подтверждённом отзыве/обращении, без отмены заказа. Согласие действует до достижения этой цели или отзыва. Отозвать его можно по адресу ` + o.Contact + `, с соразмерной проверкой принадлежности заказа. Закрытые резервные копии истекают не позднее 14 дней; при восстановлении удаления применяются до открытия доступа.\n\nЯ могу оставить поля пустыми, не давать согласие и получить заказ по номеру. Согласие не связано с рекламой и не объединено с принятием иных документов. Отдельная отметка в форме и версия этого текста фиксируются со временем сервера; минимальное доказательство хранится отдельно три года для защиты прав по утверждённой оператором политике.\n\nВерсия шаблона: ` + privacyTemplate + `.`
	if o.Telegram {
		policy += `\n\n8. Telegram\nПо отдельному добровольному согласию сервис связывает идентификатор Telegram с конкретным заказом и передаёт через Bot API номер заказа, адрес выдачи и статус (принят, готов, отменён). Имя, username, фото и телефон из Telegram не сохраняются. Получатель сообщений и инфраструктура Telegram должны быть указаны оператором в обработчиках и местах обработки; использование иностранной инфраструктуры требует отдельной правовой оценки. Связь заказа с Telegram и доступ по кнопке действуют до семи дней после завершения или отмены; личная квитанция браузера сохраняет собственный годовой срок. Отказ не мешает заказу. /stop в боте или отключение в заказе прекращают уведомления. Удаление записей сервиса не удаляет сообщения и копии в Telegram. Доставка и звук не гарантируются. Токены временного входа действуют до 30 минут, незавершённые намерения отправки — до часа; обновления бота для защиты от дублей — до 24 часов. Обратитесь к оператору для доступа, отзыва или удаления. Удаления применяются к резервным копиям по общему порядку восстановления.`
	}
	return strings.ReplaceAll(policy, `\n`, "\n"), strings.ReplaceAll(consent, `\n`, "\n")
}

func telegramConsentText(o Operator) string {
	if !o.Telegram {
		return ""
	}
	return fmt.Sprintf("Отдельное согласие на уведомления о заказе в Telegram\n\nОператор: %s, ИНН %s, ОГРН/ОГРНИП %s, адрес: %s. Контакт для отзыва и обращений: %s.\n\nДобровольно разрешаю связать мой идентификатор Telegram с этим заказом для отправки сообщений: заказ принят, готов к выдаче, отменён. Разрешённые действия: сбор, запись, хранение, использование, передача через Telegram Bot API, блокирование и удаление. В Telegram передаются номер заказа, адрес выдачи и статус; имя и комментарий заказа не передаются. Получатели/обработчики: %s. Места обработки: %s.\n\nСогласие действует до достижения цели, отзыва или семи дней после завершения/отмены. Отключить уведомления можно на странице этого заказа, командой /stop в боте или через контакт оператора. Отказ не мешает заказу и не отменяет его. Это отдельное согласие, не согласие на рекламу или обработку имени/комментария. Минимальное доказательство хранится отдельно три года по утверждённой политике; сообщения и их копии в Telegram не удаляются при очистке сервиса. Закрытые резервные копии истекают не позднее 14 дней, удаления повторяются перед открытием восстановленной системы.\n\nШаблон: %s.", o.LegalName, o.INN, o.Registration, o.Address, o.Contact, o.Contractors, o.Locations, privacyTemplate)
}

func scanPrivacy(row interface{ Scan(...any) error }) (*PrivacyDocument, error) {
	d := new(PrivacyDocument)
	var raw []byte
	e := row.Scan(&d.ID, &d.Template, &raw, &d.Policy, &d.Consent, &d.PublishedAt, &d.TelegramConsent)
	if e == sql.ErrNoRows {
		return nil, nil
	}
	if e == nil {
		e = json.Unmarshal(raw, &d.Operator)
	}
	return d, e
}

const privacyCols = "id,template_version,operator,policy,consent,published_at,telegram_consent"

func (s *Store) Privacy(ctx context.Context) (PrivacyState, error) {
	var state PrivacyState
	var raw []byte
	var current sql.NullInt64
	e := s.DB.QueryRowContext(ctx, "SELECT draft,revision,current_version,retention_enabled,last_maintenance_at FROM privacy_settings WHERE id=1").Scan(&raw, &state.Revision, &current, &state.RetentionEnabled, &state.LastMaintenance)
	if e != nil {
		return state, e
	}
	if e = json.Unmarshal(raw, &state.Draft); e != nil {
		return state, e
	}
	if current.Valid {
		state.Current, e = scanPrivacy(s.DB.QueryRowContext(ctx, "SELECT "+privacyCols+" FROM privacy_versions WHERE id=$1", current.Int64))
	}
	state.PreviewPolicy, state.PreviewConsent = privacyTexts(state.Draft)
	state.PreviewTelegramConsent = telegramConsentText(state.Draft)
	return state, e
}
func (a *API) privacyPublic(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var d *PrivacyDocument
	var e error
	if id != "" {
		n, err := strconv.ParseInt(id, 10, 64)
		if err != nil || n < 1 {
			fail(w, ErrMissing)
			return
		}
		d, e = scanPrivacy(a.Store.DB.QueryRowContext(r.Context(), "SELECT "+privacyCols+" FROM privacy_versions WHERE id=$1", n))
	} else {
		d, e = scanPrivacy(a.Store.DB.QueryRowContext(r.Context(), "SELECT "+privacyCols+" FROM privacy_versions WHERE id=(SELECT current_version FROM privacy_settings WHERE id=1)"))
	}
	if e != nil {
		fail(w, e)
		return
	}
	if d == nil {
		fail(w, problem(404, "Документы оператора ещё не опубликованы. Новые заказы недоступны."))
		return
	}
	reply(w, 200, d)
}
func (a *API) privacyOwner(w http.ResponseWriter, r *http.Request) {
	state, e := a.Store.Privacy(r.Context())
	if e != nil {
		fail(w, e)
		return
	}
	reply(w, 200, state)
}
func (a *API) privacyDraft(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Draft    Operator `json:"draft"`
		Revision int64    `json:"revision"`
	}
	if !decode(w, r, &in) {
		return
	}
	if e := in.Draft.validate(false); e != nil {
		fail(w, e)
		return
	}
	result, e := a.Store.DB.ExecContext(r.Context(), "UPDATE privacy_settings SET draft=$1,revision=revision+1 WHERE id=1 AND revision=$2", mustJSON(in.Draft), in.Revision)
	if e != nil {
		fail(w, e)
		return
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		fail(w, problem(409, "Черновик изменён в другой вкладке. Обновите страницу."))
		return
	}
	a.privacyOwner(w, r)
}
func (a *API) privacyPublish(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Revision int64 `json:"revision"`
	}
	if !decode(w, r, &in) {
		return
	}
	tx, e := a.Store.DB.BeginTx(r.Context(), nil)
	if e != nil {
		fail(w, e)
		return
	}
	defer tx.Rollback()
	var raw []byte
	var rev int64
	e = tx.QueryRowContext(r.Context(), "SELECT draft,revision FROM privacy_settings WHERE id=1 FOR UPDATE").Scan(&raw, &rev)
	if e != nil {
		fail(w, e)
		return
	}
	if rev != in.Revision {
		fail(w, problem(409, "Черновик изменился. Просмотрите его снова."))
		return
	}
	var o Operator
	if e = json.Unmarshal(raw, &o); e != nil {
		fail(w, e)
		return
	}
	if e = o.validate(true); e != nil {
		fail(w, e)
		return
	}
	policy, consent := privacyTexts(o)
	var id int64
	e = tx.QueryRowContext(r.Context(), "INSERT INTO privacy_versions(template_version,operator,policy,consent,actor_id,telegram_consent) VALUES($1,$2,$3,$4,$5,$6) RETURNING id", privacyTemplate, raw, policy, consent, actor(r.Context()).ID, telegramConsentText(o)).Scan(&id)
	if e == nil {
		_, e = tx.ExecContext(r.Context(), "UPDATE privacy_settings SET current_version=$1,revision=revision+1 WHERE id=1", id)
	}
	if e == nil {
		e = audit(r.Context(), tx, "privacy.publish", fmt.Sprint(id))
	}
	if e == nil {
		e = tx.Commit()
	}
	if e != nil {
		fail(w, e)
		return
	}
	a.privacyOwner(w, r)
}

func checkPrivacy(ctx context.Context, tx *sql.Tx, c Checkout) (int64, error) {
	var id sql.NullInt64
	if e := tx.QueryRowContext(ctx, "SELECT current_version FROM privacy_settings WHERE id=1 FOR SHARE").Scan(&id); e != nil {
		return 0, e
	}
	if !id.Valid {
		return 0, problem(409, "Оператор ещё не опубликовал документы. Приём новых заказов недоступен.")
	}
	if c.Privacy == nil || c.Privacy.NoticeVersion != id.Int64 {
		return 0, problem(409, "Документы обновились. Обновите страницу и проверьте согласие перед отправкой.")
	}
	if (c.Name != "" || c.Note != "") && (!c.Privacy.Accepted || c.Privacy.ConsentVersion != id.Int64) {
		return 0, problem(400, "Для имени и комментария нужно отдельное согласие. Можно оставить поля пустыми и заказать по номеру.")
	}
	if c.Privacy.Accepted && c.Privacy.ConsentVersion != id.Int64 {
		return 0, problem(409, "Версия согласия изменилась. Обновите страницу.")
	}
	return id.Int64, nil
}
