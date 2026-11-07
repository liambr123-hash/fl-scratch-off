"""Protect search landing content and archived URLs during shared-shell rebuilds."""
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest
import xml.etree.ElementTree as ET

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from pipeline.discovery import decorate_landing_pages


UNIQUE_TABLE = '<table><thead><tr><th>Prize</th><th>Remaining</th></tr></thead><tbody><tr><td>$15,000,000</td><td>2</td></tr></tbody></table>'


def page(path, title='Platinum Payout odds', content=None):
    content = content or ('<h1>Platinum Payout</h1><p class="lead">Game #1647 has 2 of 2 top prizes left.</p>'
                          '<p><a class="cta" href="/#game/1647">Open the interactive version</a></p>' + UNIQUE_TABLE)
    return f'''<!doctype html><html lang="en"><head>
<title>{title}</title><meta name="description" content="Unique game summary">
<link rel="canonical" href="https://flscratchstats.com{path}">
<link rel="stylesheet" href="/style.css"><style>body{{background:black}}</style>
<script type="application/ld+json">{{"@context":"https://schema.org","@type":"WebPage","dateModified":"2026-10-20"}}</script>
</head><body><header>Legacy header</header><main>{content}</main><footer>Legacy footer</footer></body></html>'''


class LandingDiscoveryTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.public = Path(self.temp.name)
        (self.public / 'g').mkdir()
        (self.public / 'index.html').write_text('Homepage owned by another builder')
        (self.public / 'g' / '1647.html').write_text(page('/g/1647'))
        (self.public / 'sitemap.xml').write_text('''<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://flscratchstats.com/</loc><lastmod>2026-11-06</lastmod></url><url><loc>https://flscratchstats.com/g/1647</loc><lastmod>2026-10-20</lastmod></url></urlset>''')
        self.data = {'games': [{'game_no': '1647'}]}

    def tearDown(self):
        self.temp.cleanup()

    def test_unique_search_content_survives_and_detail_links_work(self):
        result = decorate_landing_pages(self.public, self.data)
        output = (self.public / 'g' / '1647.html').read_text()
        self.assertEqual(result, {'decorated': 1, 'archived': 0})
        self.assertIn('<title>Platinum Payout odds</title>', output)
        self.assertIn('content="Unique game summary"', output)
        self.assertIn('href="https://flscratchstats.com/g/1647"', output)
        self.assertIn(UNIQUE_TABLE, output)
        self.assertIn('dateModified":"2026-10-20"', output)
        self.assertIn('href="/?game=1647#tickets"', output)
        self.assertIn('<p class="landing-top-cta"><a class="button primary" href="/?game=1647#tickets">Open game</a></p>', output)
        self.assertLess(output.index('class="landing-top-cta"'), output.index('<!-- discovery:content:start -->'))
        self.assertIn('href="/#tickets">All tickets</a>', output)
        self.assertLess(output.index('href="/assets/site.css"'), output.index('href="/assets/visual.css?v=3"'))
        for target, label in [('tickets', 'Tickets'), ('new-games', 'New'), ('changes', 'Claims'),
                              ('deadlines', 'Dates'), ('methodology', 'Help'), ('support', 'Support')]:
            self.assertIn(f'href="/#{target}">{label}</a>', output)
        self.assertIn('href="/#support"', output)
        self.assertIn('href="#main-content"', output)
        self.assertEqual(output.count('<h1>'), 1)
        self.assertNotIn('Legacy header', output)
        self.assertNotIn('/style.css', output)
        self.assertNotIn('<style>', output)
        self.assertNotIn('location.replace', output)
        self.assertEqual((self.public / 'index.html').read_text(), 'Homepage owned by another builder')

    def test_repeated_decoration_does_not_accumulate_markup_or_change_content(self):
        decorate_landing_pages(self.public, self.data)
        first = (self.public / 'g' / '1647.html').read_bytes()
        sitemap = (self.public / 'sitemap.xml').read_bytes()
        decorate_landing_pages(self.public, self.data)
        self.assertEqual((self.public / 'g' / '1647.html').read_bytes(), first)
        self.assertEqual((self.public / 'sitemap.xml').read_bytes(), sitemap)
        self.assertEqual(first.count(b'class="landing-top-cta"'), 1)
        self.assertEqual(first.count(b'href="/assets/visual.css?v=3"'), 1)

    def test_missing_game_retains_snapshot_and_accurate_archival_metadata(self):
        # A prior URL is present on disk but no longer in today's feed/sitemap.
        (self.public / 'g' / '1518.html').write_text(page('/g/1518', 'The Price Is Right odds', '<h1>The Price Is Right</h1><p>Historic prize count: 4.</p>' + UNIQUE_TABLE))
        result = decorate_landing_pages(self.public, self.data)
        output = (self.public / 'g' / '1518.html').read_text()
        self.assertEqual(result['archived'], 1)
        self.assertIn('Archived game snapshot', output)
        self.assertIn('not confirmation of current sales', output)
        self.assertIn('Historic prize count: 4.', output)
        self.assertIn(UNIQUE_TABLE, output)
        self.assertIn('The Price Is Right odds — archived snapshot', output)
        self.assertIn('href="https://flscratchstats.com/g/1518"', output)
        self.assertNotIn('/?game=1518', output)
        self.assertIn('<p class="landing-top-cta"><a class="button primary" href="/#tickets">See tickets</a></p>', output)
        sitemap = ET.fromstring((self.public / 'sitemap.xml').read_text())
        namespace = {'s': 'http://www.sitemaps.org/schemas/sitemap/0.9'}
        entry = next(item for item in sitemap.findall('s:url', namespace)
                     if item.find('s:loc', namespace).text.endswith('/g/1518'))
        self.assertEqual(entry.find('s:lastmod', namespace).text, '2026-10-20')
        first = output
        decorate_landing_pages(self.public, self.data)
        self.assertEqual((self.public / 'g' / '1518.html').read_text(), first)

    def test_about_gets_heading_and_price_page_links_to_filtered_home(self):
        (self.public / 'about.html').write_text(page('/about', 'About · FL Scratch Stats', '<div class="prose"><h2>How estimates work</h2><p>A unique method.</p></div>'))
        (self.public / 'florida-10-scratch-offs.html').write_text(page('/florida-10-scratch-offs', 'Florida $10 scratch-offs'))
        decorate_landing_pages(self.public, self.data)
        self.assertIn('<h1>About &amp; methodology</h1>', (self.public / 'about.html').read_text())
        self.assertIn('A unique method.', (self.public / 'about.html').read_text())
        self.assertIn('<p class="landing-top-cta"><a class="button primary" href="/#methodology">Help</a></p>', (self.public / 'about.html').read_text())
        self.assertIn('href="/?price=10#tickets"', (self.public / 'florida-10-scratch-offs.html').read_text())
        self.assertIn('<p class="landing-top-cta"><a class="button primary" href="/?price=10#tickets">See tickets</a></p>', (self.public / 'florida-10-scratch-offs.html').read_text())

    def test_quarantined_game_keeps_evidence_without_a_comparison_entry_link(self):
        content = ('<h1>Gold Rush Doubler</h1><p class="quality-note">'
                   'Quarantined: winner report predates this game. Estimated payout withheld.</p>'
                   '<p><a class="cta" href="/#game/1384">Open the interactive version</a></p>'
                   + UNIQUE_TABLE)
        target = self.public / 'g' / '1384.html'
        target.write_text(page('/g/1384', 'Gold Rush Doubler source limitations', content))
        self.data['games'].append({'game_no': '1384', 'source_status': 'quarantined',
                                   'recommendation_eligible': False})
        decorate_landing_pages(self.public, self.data)
        output = target.read_text()
        self.assertIn('href="https://flscratchstats.com/g/1384"', output)
        self.assertIn('Estimated payout withheld.', output)
        self.assertIn(UNIQUE_TABLE, output)
        self.assertIn('<p class="landing-top-cta"><a class="button primary" href="/#tickets">See tickets</a></p>', output)
        self.assertIn('href="/#tickets">All tickets</a>', output)
        self.assertNotIn('/?game=1384', output)
        self.assertNotIn('/#game/1384', output)
        self.assertNotIn('Archived game snapshot', output)
        decorate_landing_pages(self.public, self.data)
        self.assertEqual(target.read_text(), output)

    def test_noncanonical_assets_and_foreign_canonicals_are_untouched(self):
        foreign = page('/g/1647').replace('https://flscratchstats.com/g/1647', 'https://example.com/g/1647')
        (self.public / 'external.html').write_text(foreign)
        (self.public / '404.html').write_text('<h1>Not found</h1>')
        # Do not silently wrap a second file canonicalized to the home page.
        duplicate_home = page('/')
        (self.public / 'duplicate.html').write_text(duplicate_home)
        decorate_landing_pages(self.public, self.data)
        self.assertEqual((self.public / 'external.html').read_text(), foreign)
        self.assertEqual((self.public / '404.html').read_text(), '<h1>Not found</h1>')
        self.assertEqual((self.public / 'duplicate.html').read_text(), duplicate_home)


if __name__ == '__main__':
    unittest.main()
