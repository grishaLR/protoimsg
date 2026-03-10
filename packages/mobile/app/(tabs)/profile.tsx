import { useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Switch } from 'react-native';
import { useTranslation } from 'react-i18next';
import { LANGUAGES } from '@/i18n/languages';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@/services/auth';
import { useTheme, useAimStyle, AIM_DESKTOP, AIM_WINDOW_SHADOW } from '@/theme';
import { BeveledView } from '@/components/BeveledView';
import { AimTitlebar } from '@/components/AimTitlebar';
import { themes, THEME_NAMES, THEME_I18N_KEYS, isDarkTheme, type ThemeName } from '@/theme/themes';
import { isSoundEnabled, setSoundEnabled } from '@/services/sounds';
import { useContentTranslation } from '@/hooks/useContentTranslation';
import {
  getIpProtectionLevel,
  setIpProtectionLevel,
  type IpProtectionLevel,
} from '@/services/DmContext';
import { spacing, radius, fontSize } from '@/theme/tokens';

function ThemeSwatch({
  name,
  label,
  isActive,
  onPress,
}: {
  name: ThemeName;
  label: string;
  isActive: boolean;
  onPress: () => void;
}) {
  const t = themes[name];
  const dark = isDarkTheme(name);
  const { aimRadius } = useAimStyle();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: isActive }}
      style={[
        styles.swatch,
        {
          backgroundColor: t.base100,
          borderColor: isActive ? t.primary : t.borderDark,
          borderWidth: isActive ? 2.5 : 1,
          borderRadius: aimRadius ?? radius.md,
        },
      ]}
    >
      <View style={[styles.swatchStripe, { backgroundColor: t.primary }]} />
      <Text style={[styles.swatchLabel, { color: dark ? '#ffffff' : '#000000' }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

export default function ProfileScreen() {
  const { t, i18n } = useTranslation(['settings', 'common']);
  const { handle, logout } = useAuth();
  const { colors, theme, setTheme } = useTheme();
  const { isAim, aimRadius } = useAimStyle();
  const [soundOn, setSoundOn] = useState(isSoundEnabled);
  const [ipProtection, setIpProtection] = useState<IpProtectionLevel>(getIpProtectionLevel);
  const {
    autoTranslate,
    setAutoTranslate,
    available: translateAvailable,
  } = useContentTranslation();

  const profileContent = (
    <>
      <View
        style={[styles.header, { borderBottomColor: isAim ? colors.borderDark : colors.base200 }]}
      >
        <Text style={[styles.title, { color: colors.baseContent }]}>{t('profile.title')}</Text>
      </View>
      <BeveledView
        variant="sunken"
        style={isAim ? styles.aimContentBevel : undefined}
        innerStyle={isAim ? { backgroundColor: colors.surfaceContent } : undefined}
      >
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <Text style={[styles.handle, { color: colors.baseContent }]}>@{handle ?? '...'}</Text>

          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.chromeTextMuted }]}>
              {t('appearance.title')}
            </Text>
            <View style={styles.themeGrid}>
              {THEME_NAMES.map((name) => (
                <ThemeSwatch
                  key={name}
                  name={name}
                  label={t(`common:theme.${THEME_I18N_KEYS[name]}`, { defaultValue: name })}
                  isActive={theme === name}
                  onPress={() => {
                    setTheme(name);
                  }}
                />
              ))}
            </View>
          </View>

          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.chromeTextMuted }]}>
              {t('language.title')}
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.languageRow}
            >
              {LANGUAGES.map((lang) => (
                <Pressable
                  key={lang.code}
                  onPress={() => void i18n.changeLanguage(lang.code)}
                  style={[
                    styles.languagePill,
                    {
                      backgroundColor:
                        i18n.language === lang.code
                          ? colors.primary
                          : isAim
                            ? colors.base100
                            : colors.base200,
                      borderRadius: aimRadius ?? radius.pill,
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: i18n.language === lang.code }}
                >
                  <Text
                    style={[
                      styles.languagePillText,
                      {
                        color:
                          i18n.language === lang.code ? colors.primaryContent : colors.baseContent,
                      },
                    ]}
                  >
                    {lang.label}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>

          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.chromeTextMuted }]}>
              {t('preferences.title')}
            </Text>
            <View
              style={[
                styles.settingRow,
                {
                  backgroundColor: isAim ? colors.base100 : colors.surfaceContent,
                  borderRadius: aimRadius ?? radius.sm,
                },
              ]}
            >
              <Text style={[styles.settingLabel, { color: colors.baseContent }]}>
                {t('notifications.enableSounds')}
              </Text>
              <Switch
                value={soundOn}
                onValueChange={(v) => {
                  setSoundOn(v);
                  setSoundEnabled(v);
                }}
                trackColor={{ false: colors.base300, true: colors.primary }}
                thumbColor="#ffffff"
              />
            </View>
            {translateAvailable && (
              <View
                style={[
                  styles.settingRow,
                  {
                    backgroundColor: isAim ? colors.base100 : colors.surfaceContent,
                    borderRadius: aimRadius ?? radius.sm,
                  },
                ]}
              >
                <View style={styles.settingLabelGroup}>
                  <Text style={[styles.settingLabel, { color: colors.baseContent }]}>
                    {t('translation.autoTranslate')}
                  </Text>
                  <Text style={[styles.settingHint, { color: colors.chromeTextMuted }]}>
                    {t('translation.autoTranslateHint')}
                  </Text>
                </View>
                <Switch
                  value={autoTranslate}
                  onValueChange={setAutoTranslate}
                  trackColor={{ false: colors.base300, true: colors.primary }}
                  thumbColor="#ffffff"
                />
              </View>
            )}
          </View>

          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.chromeTextMuted }]}>
              {t('privacy.title')}
            </Text>
            <Text style={[styles.settingDescription, { color: colors.chromeTextMuted }]}>
              {t('privacy.ipDescription')}
            </Text>
            <View
              style={[
                styles.segmentRow,
                {
                  backgroundColor: isAim ? colors.base100 : colors.base300,
                  borderRadius: aimRadius ?? radius.sm,
                },
              ]}
            >
              <Pressable
                style={[
                  styles.segment,
                  { borderRadius: aimRadius ?? radius.sm },
                  ipProtection === 'non-inner-circle' && {
                    backgroundColor: colors.primary,
                  },
                ]}
                onPress={() => {
                  setIpProtection('non-inner-circle');
                  setIpProtectionLevel('non-inner-circle');
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: ipProtection === 'non-inner-circle' }}
              >
                <Text
                  style={[
                    styles.segmentText,
                    {
                      color:
                        ipProtection === 'non-inner-circle'
                          ? colors.primaryContent
                          : colors.baseContent,
                    },
                  ]}
                >
                  {t('privacy.relayExceptIc')}
                </Text>
              </Pressable>
              <Pressable
                style={[
                  styles.segment,
                  { borderRadius: aimRadius ?? radius.sm },
                  ipProtection === 'all' && { backgroundColor: colors.primary },
                ]}
                onPress={() => {
                  setIpProtection('all');
                  setIpProtectionLevel('all');
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: ipProtection === 'all' }}
              >
                <Text
                  style={[
                    styles.segmentText,
                    {
                      color: ipProtection === 'all' ? colors.primaryContent : colors.baseContent,
                    },
                  ]}
                >
                  {t('privacy.relayAlways')}
                </Text>
              </Pressable>
            </View>
          </View>

          <Pressable
            style={[
              styles.logoutButton,
              {
                backgroundColor: colors.primary,
                borderRadius: aimRadius ?? radius.sm,
              },
            ]}
            onPress={logout}
            accessibilityRole="button"
            accessibilityLabel={t('actions.signOut')}
          >
            <Text style={[styles.logoutText, { color: colors.primaryContent }]}>
              {t('actions.signOut')}
            </Text>
          </Pressable>
        </ScrollView>
      </BeveledView>
    </>
  );

  if (isAim) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: AIM_DESKTOP }]}>
        <BeveledView
          variant="raised"
          style={[styles.aimWindowFrame, { backgroundColor: colors.base100 }, AIM_WINDOW_SHADOW]}
          innerStyle={{ backgroundColor: colors.base100 }}
        >
          <AimTitlebar title={`${t('common:appName')} - ${t('profile.title')}`} />
          {profileContent}
        </BeveledView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.surface }]}>
      {profileContent}
    </SafeAreaView>
  );
}

const SWATCH_SIZE = 72;

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: spacing[8],
    paddingVertical: spacing[6],
    borderBottomWidth: 1,
  },
  title: {
    fontSize: fontSize['2xl'],
    fontWeight: '700',
  },
  scrollContent: {
    padding: spacing[8],
    gap: spacing[12],
  },
  handle: {
    fontSize: fontSize.xl,
    textAlign: 'center',
  },
  section: {
    gap: spacing[4],
  },
  sectionTitle: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  themeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[3],
  },
  swatch: {
    width: SWATCH_SIZE,
    height: SWATCH_SIZE,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  swatchStripe: {
    height: 4,
  },
  swatchLabel: {
    fontSize: 10,
    fontWeight: '600',
    textAlign: 'center',
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing[6],
    paddingVertical: spacing[4],
  },
  settingLabel: {
    fontSize: fontSize.base,
  },
  settingLabelGroup: {
    flex: 1,
    marginRight: spacing[4],
  },
  settingHint: {
    fontSize: fontSize.xs,
    lineHeight: 16,
    marginTop: spacing[1],
  },
  settingDescription: {
    fontSize: fontSize.xs,
    lineHeight: 16,
  },
  segmentRow: {
    flexDirection: 'row',
    overflow: 'hidden',
  },
  segment: {
    flex: 1,
    paddingVertical: spacing[4],
    alignItems: 'center',
  },
  segmentText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  logoutButton: {
    paddingHorizontal: spacing[12],
    paddingVertical: spacing[6],
    alignSelf: 'center',
  },
  logoutText: {
    fontWeight: '600',
    fontSize: fontSize.lg,
  },
  languageRow: {
    gap: spacing[3],
    paddingVertical: spacing[1],
  },
  languagePill: {
    paddingHorizontal: spacing[6],
    paddingVertical: spacing[3],
  },
  languagePillText: {
    fontSize: fontSize.sm,
    fontWeight: '500',
  },
  // AIM-specific styles
  aimWindowFrame: {
    flex: 1,
    margin: spacing[3],
  },
  aimContentBevel: {
    flex: 1,
    marginHorizontal: spacing[4],
    marginBottom: spacing[4],
  },
});
