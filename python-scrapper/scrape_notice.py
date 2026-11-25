import requests
from bs4 import BeautifulSoup
import sqlite3
import logging
import sys
import io
import time
from urllib.parse import urljoin

# Force UTF-8 on Windows Console to prevent emoji crashes
if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('scraper.log', encoding='utf-8'),
        logging.StreamHandler(sys.stdout)
    ]
)

class TuNoticeScraper:
    def __init__(self):
        self.list_url = "https://www.tu.ac.kr/ic/sub05_01.do"
        self.base_domain = "https://www.tu.ac.kr"
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
        })
        self.setup_database()
    
    def setup_database(self):
        conn = sqlite3.connect('notices.db')
        cursor = conn.cursor()
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS notices (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                notice_number TEXT,
                title TEXT,
                date_created TEXT,
                views INTEGER,
                content TEXT,
                images TEXT,
                url TEXT UNIQUE,
                scraped_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        conn.commit()
        conn.close()

    def url_exists(self, url: str) -> bool:
        """Return True if a notice with this URL is already in the database."""
        conn = sqlite3.connect('notices.db')
        cursor = conn.cursor()
        cursor.execute('SELECT 1 FROM notices WHERE url = ? LIMIT 1', (url,))
        exists = cursor.fetchone() is not None
        conn.close()
        return exists

    def get_page_url(self, page_num):
        offset = (page_num - 1) * 10
        return f"{self.list_url}?article.offset={offset}&articleLimit=10"
    
    def extract_notice_links(self, page_num=1):
        url = self.get_page_url(page_num)
        try:
            response = self.session.get(url, timeout=30)
            response.raise_for_status()
            soup = BeautifulSoup(response.text, 'html.parser')
            
            notices = []
            table = soup.find('table')
            if table:
                rows = table.find_all('tr')[1:]
                for row in rows:
                    cells = row.find_all('td')
                    if len(cells) >= 3:
                        notice_num = cells[0].text.strip()
                        if notice_num.isdigit():
                            link = cells[1].find('a')
                            if link:
                                title = " ".join(link.text.split())
                                href = link.get('href')
                                
                                # FIX: Correctly build the detail URL
                                if href.startswith('?'):
                                    notice_url = f"{self.list_url}{href}"
                                else:
                                    notice_url = urljoin(self.base_domain, href)
                                    
                                date = cells[2].text.strip()
                                views_text = cells[4].text.strip() if len(cells) > 4 else "0"
                                
                                notices.append({
                                    'number': notice_num,
                                    'title': title,
                                    'date': date,
                                    'views': int(views_text.replace(',', '')) if views_text.replace(',', '').isdigit() else 0,
                                    'url': notice_url
                                })
            
            logging.info(f"Found {len(notices)} notices on page {page_num}")
            return notices
        except Exception as e:
            logging.error(f"Error extracting page {page_num}: {e}")
            return []
    
    def scrape_notice_detail(self, url):
        try:
            response = self.session.get(url, timeout=30)
            response.raise_for_status()
            soup = BeautifulSoup(response.text, 'html.parser')
            
            # Try multiple possible content containers for robustness
            content_div = (soup.find('div', class_='contents') or 
                           soup.find('div', class_='board_view') or 
                           soup.find('div', id='cms-content') or 
                           soup.find('article'))
            
            if content_div:
                content = content_div.get_text(separator='\n', strip=True)
                images = [urljoin(self.base_domain, img.get('src')) for img in content_div.find_all('img') if img.get('src')]
                return {'content': content, 'images': ','.join(images)}
            else:
                logging.warning(f"Could not find content div in {url}")
                return {'content': soup.body.get_text(separator='\n', strip=True) if soup.body else '', 'images': ''}
        except Exception as e:
            logging.error(f"Error scraping {url}: {e}")
            return {'content': '', 'images': ''}
    
    def save_notice(self, notice, detail):
        conn = sqlite3.connect('notices.db')
        cursor = conn.cursor()
        try:
            cursor.execute('''
                INSERT OR IGNORE INTO notices 
                (notice_number, title, date_created, views, content, images, url)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            ''', (notice['number'], notice['title'], notice['date'], notice['views'], detail['content'], detail['images'], notice['url']))
            conn.commit()
            if cursor.rowcount > 0:
                logging.info(f"Saved: {notice['title']}")
        except Exception as e:
            logging.error(f"Error saving: {e}")
        finally:
            conn.close()
    
    def run(self):
        logging.info("Starting notice scraping...")
        new_total = 0

        for page in range(1, 10):
            logging.info(f"Scraping page {page}/9...")
            notices = self.extract_notice_links(page)

            if not notices:
                break

            new_on_page = 0
            for notice in notices:
                if self.url_exists(notice['url']):
                    logging.info(f"  Already known — skipping: {notice['title'][:60]}")
                    continue

                logging.info(f"  New — scraping detail: {notice['title'][:60]}")
                detail = self.scrape_notice_detail(notice['url'])
                self.save_notice(notice, detail)
                new_on_page += 1
                new_total += 1
                time.sleep(0.5)

            # Early exit: if not a single notice on this page was new,
            # every older page will also be fully known — stop now.
            if new_on_page == 0:
                logging.info(f"  No new notices on page {page} — stopping early.")
                break

            time.sleep(1)

        logging.info(f"Scraping complete. {new_total} new notice(s) added.")

if __name__ == "__main__":
    TuNoticeScraper().run()