"""Data-population script for Course 2 ("Investing & Financial Markets").

Same shape and reasoning as seed_course1.py: lessons need real uploaded PDF
file_refs (summary + slides) created through the Supabase Storage layer
first, with the resulting file IDs baked into the lesson docs, so this is a
source-data-driven population step rather than startup-seed logic.

Course 2 is being built lesson by lesson as the material arrives, so this
script is designed to be run repeatedly:

  * the course is upserted by slug
  * each lesson is upserted by (course_id, order)

Re-running never creates duplicates — it refreshes whatever is listed in
LESSONS below and leaves lessons that are not listed untouched. To add the
next lesson, append one entry to LESSONS and run the script again.

The certificate artwork says "all lessons" rather than a fixed count, so the
course can gain or lose a lesson without the certificate becoming wrong.
TOTAL_LESSONS below is only used for the "x of y built" progress report.

Usage (from backend/, with the project's venv):

    ./.venv/bin/python3 scripts/seed_course2.py

Note: this writes to the live Supabase database that the deployed site uses.
"""
import asyncio
import sys
import uuid
from pathlib import Path

ROOT_DIR = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT_DIR))

from dotenv import load_dotenv
load_dotenv(ROOT_DIR / ".env")

import os
from pg_shim import PGClient
from storage_service import put_object, build_upload_path

# Lesson PDFs are kept in the repo folder, not ~/Downloads. Downloads was
# cleared twice while this course was being built, each time taking lesson
# material with it, which silently turned attached PDFs back into None on the
# next run. Files are copied here as they arrive and stay put.
MATERIALS = Path(__file__).parent.parent.parent / "course2-materials"
DOWNLOADS = Path("/Users/veersinghsahni/Downloads")


def material(filename: str) -> Path:
    """Path to a lesson PDF: the repo copy if it is there, otherwise whatever
    is still sitting in ~/Downloads. Returns the repo path when neither
    exists, so the 'file missing' report names the place to put it."""
    kept = MATERIALS / filename
    if kept.exists():
        return kept
    fresh = DOWNLOADS / filename
    if fresh.exists():
        MATERIALS.mkdir(exist_ok=True)
        kept.write_bytes(fresh.read_bytes())
        print(f"  kept a copy of {filename} in course2-materials/")
        return kept
    return kept

supabase_url = os.environ["SUPABASE_URL"]
supabase_key = os.environ.get("SUPABASE_SECRET_KEY") or os.environ["SUPABASE_SERVICE_ROLE_KEY"]
db = PGClient(supabase_url, supabase_key)

SLUG = "investing-and-financial-markets"
TOTAL_LESSONS = 10  # planned length, used only for the progress report below


def now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


async def upload_material(path: Path) -> str:
    """Uploads a PDF to Supabase Storage, creates a file_refs row with
    kind='course_material', returns the new FileRef id."""
    data = path.read_bytes()
    storage_path = build_upload_path("course-materials", "pdf")
    result = put_object(storage_path, data, "application/pdf")
    ref_id = str(uuid.uuid4())
    ref = {
        "id": ref_id,
        "storage_path": result["path"],
        "original_filename": path.name,
        "content_type": "application/pdf",
        "size": int(result.get("size") or len(data)),
        "kind": "course_material",
        "created_at": now_iso(),
        "is_deleted": False,
    }
    await db.file_refs.insert_one(ref)
    print(f"  uploaded {path.name} -> file_refs/{ref_id}")
    return ref_id


# Each entry:
#   order        1-10, drives the lesson sequence shown to learners
#   title        lesson title as it appears in the course
#   youtube_url  full watch/share link, or None until the video exists
#   summary      Path to the summary PDF, or None
#   ppt          Path to the slides PDF, or None
#   quiz         list of (question, [options], correct_index, explanation)
#
# A lesson with an empty quiz cannot be passed, and the certificate only
# unlocks once every lesson in the course is passed — so leave a lesson out
# of this list entirely until its quiz is ready, rather than adding it with
# quiz=[].
LESSONS = [
    {
        "order": 1,
        "title": "Why Invest at All: Inflation and the Time Value of Money",
        "youtube_url": "https://youtu.be/j-2PR_ptdy4",
        "summary": material("SCALE-C2-L01-Summary-73f65a03.pdf"),
        "ppt": material("SCALE-C2-L01-Ppt-7533da5a.pdf"),
        # The ten multiple-choice questions from the lesson quiz, in the same
        # order and wording as the PDF so a learner working from the printout
        # sees the same paper. The PDF's two written practice problems are not
        # here: they need working shown, which the site cannot mark.
        "quiz": [
            ("What does inflation do to the purchasing power of money over time?",
             ["Increases it", "Decreases it", "Leaves it unchanged", "Doubles it every year"], 1,
             "Inflation is the general rise in prices, so the same amount of money buys less each year: purchasing power falls."),
            ("₹10,000 is placed at 7% simple interest for 5 years. What is it worth at the end?",
             ["₹10,700", "₹13,500", "₹14,026", "₹17,000"], 1,
             "Simple interest = 10,000 x 0.07 x 5 = ₹3,500. Total = 10,000 + 3,500 = ₹13,500."),
            ("Why does compound interest eventually outgrow simple interest at the same rate?",
             ["The rate increases every year", "Interest is earned on the growing pile, including past interest", "Banks charge lower fees on it", "It avoids inflation completely"], 1,
             "Compounding adds each period's interest to the base, so later interest is earned on interest."),
            ("₹10,000 at 7% compounded annually is worth about how much after 10 years?",
             ["₹17,000", "₹19,672", "₹24,000", "₹38,697"], 1,
             "10,000 x 1.07^10 = about ₹19,672. ₹17,000 is the simple-interest answer; ₹38,697 is the 20-year compound answer."),
            ("An investment earns 7% while inflation is 6%. The real return is closest to:",
             ["13%", "7%", "1%", "-1%"], 2,
             "Real return is roughly nominal minus inflation: 7 - 6 = 1% (exact: 1.07/1.06 - 1 = 0.94%)."),
            ("Using the rule of 72, money growing at 9% a year doubles in about:",
             ["6 years", "8 years", "9 years", "12 years"], 1,
             "72 / 9 = 8 years."),
            ("Prices are doubling every 12 years. The rule of 72 says inflation is about:",
             ["12%", "8%", "6%", "4%"], 2,
             "72 / 12 = 6%. The rule works backwards for prices too."),
            ("Asha invests ₹2,000 a month from age 16 and Kabir the same from 26, at the same return. At 40, Asha has nearly 4 times Kabir's corpus mainly because:",
             ["She chose riskier products", "Her money had more compounding periods", "She invested 4 times more each month", "Inflation was lower in her years"], 1,
             "Same monthly amount and same return: only the ten extra years of compounding separate them."),
            ("Keeping savings in a cash box at home while inflation runs at 6% means:",
             ["The money is safe and grows slowly", "The real value of the money falls each year", "The money doubles in 12 years", "Nothing changes because cash has no risk"], 1,
             "Idle cash earns 0%, so its purchasing power falls by roughly the inflation rate every year."),
            ("Which statement best captures why people invest rather than only save?",
             ["To avoid keeping any records", "To beat inflation and grow purchasing power over time", "To guarantee quick profits", "Because saving is illegal for students"], 1,
             "Saving preserves money; investing aims to grow it faster than inflation so purchasing power actually increases."),
        ],
    },
    {
        "order": 2,
        "title": "Risk, Return and Your Time Horizon",
        "youtube_url": "https://youtu.be/ys6bWPlcBvM",
        "summary": material("SCALE-C2-L02-Summary-59c94aa8.pdf"),
        "ppt": material("SCALE-C2-L02-Ppt-027fd9fa.pdf"),
        "quiz": [
            ("Which best describes volatility?",
             ["Money lost forever in a scam", "Normal up-and-down movement of prices over time", "A guaranteed fall in prices", "The fees charged by brokers"], 1,
             "Volatility is ordinary price wobble. Losing money for good, as in a scam, is a separate thing. A forced sale can turn a paper loss into a realized one."),
            ("An investment falls 50%. What gain is needed to get back to where it started?",
             ["50%", "75%", "100%", "150%"], 2,
             "₹100 becomes ₹50. Doubling ₹50 needs a 100% gain. Recovery needed = 0.50 / (1 - 0.50) = 100%."),
            ("An investment falls 20%. The recovery needed is about:",
             ["20%", "22%", "25%", "40%"], 2,
             "0.20 / 0.80 = 25%. Recoveries act on a smaller base, so they must be larger than the fall."),
            ("Risk capacity is best described as:",
             ["How brave an investor feels about losses", "How much risk the goal's timeline and cushion can actually afford", "The maximum a broker allows you to buy", "The number of investments in a portfolio"], 1,
             "Capacity is about the situation (deadline, cushion), not the stomach (tolerance)."),
            ("A student needs ₹1.5 lakh for a course in 18 months. The most suitable approach is:",
             ["Buy volatile shares for higher returns", "A steady recurring deposit or similar safe avenue", "Wait for a market dip, then buy shares", "Keep the cash at home"], 1,
             "With a near deadline there is little time to recover from a fall, so predictability within the product's terms matters more than growth."),
            ("Why does a longer time horizon reduce, though never remove, the danger of volatility?",
             ["Prices stop moving after ten years", "Strong and weak years partly offset, narrowing the range of outcomes", "Long investments cannot fall", "Inflation stops after ten years"], 1,
             "Over long windows, yearly average returns have historically bunched into a narrower band, but the final amount still varies and loss stays possible."),
            ("A fixed deposit pays 7% and 10% of the interest goes to tax. The after-tax return is:",
             ["7.7%", "7%", "6.3%", "0.7%"], 2,
             "Tax takes 10% of the 7% interest: 7 x 0.90 = 6.3%."),
            ("If that deposit's after-tax return is 6.3% and inflation is 6%, the real return is about:",
             ["6.3%", "12.3%", "0.3%", "-6%"], 2,
             "1.063 / 1.06 - 1 = about 0.28%. Safety of principal is not safety of purchasing power."),
            ("Arjun invests ₹5,000 a month for 15 years. About how much does he actually invest in total?",
             ["₹25 lakh", "₹9 lakh", "₹15 lakh", "₹90,000"], 1,
             "5,000 x 12 x 15 = ₹9,00,000 invested. Growth takes it to about ₹25.2 lakh."),
            ("When risk tolerance and risk capacity disagree, a careful investor should follow:",
             ["Tolerance, because feelings matter", "Capacity, because a fixed deadline and a thin cushion do not change with how brave you feel", "Whichever is higher", "A friend's advice"], 1,
             "Capacity should set the limit. Comfort with risk can grow over time, but a fixed deadline will not move."),
        ],
    },
    {
        "order": 3,
        "title": "How Markets Actually Work: Exchanges, Demat, Orders and Indices",
        "youtube_url": "https://youtu.be/myX3PMMahKA",
        "summary": material("SCALE-C2-L03-Summary-321ed066.pdf"),
        "ppt": material("SCALE-C2-L03-Ppt-21df6832.pdf"),
        "quiz": [
            ("In the primary market:",
             ["Investors buy shares from other investors", "The company sells new shares and receives the money (a fresh issue)", "The exchange sets share prices", "Shares trade every second"], 1,
             "In a fresh issue the company itself sells new shares and receives the funds. In an offer for sale, existing shareholders sell and they receive the money."),
            ("An IPO is:",
             ["A type of bank account", "A company's first sale of shares to the public", "A government tax on shares", "A daily market index"], 1,
             "IPO = initial public offering, the first public sale of a company's shares."),
            ("Rohit buys 50 Konkan Koffee shares from Sana on the exchange. Konkan Koffee receives:",
             ["The full trade value", "Half the trade value", "A small commission", "Nothing"], 3,
             "Secondary-market trades move shares and money between investors. The company gets nothing."),
            ("What does a stock exchange actually do?",
             ["Sets the price of every share each morning", "Owns and sells shares on behalf of companies", "Matches buy and sell orders and enforces rules", "Guarantees investors a profit"], 2,
             "An exchange is a regulated matchmaker and scoreboard. Prices come from buyers' and sellers' orders."),
            ("A demat account is best described as:",
             ["A loan account for buying shares", "A digital locker that holds shares electronically", "A type of fixed deposit", "An account only companies can open"], 1,
             "Demat = dematerialized: shares are held as electronic records, not paper certificates."),
            ("You want to buy a share only if the price is ₹100 or lower. The right instruction is:",
             ["A market order", "A limit order at ₹100", "A stop order", "An IPO application"], 1,
             "A limit order executes only at your price or better. A market order buys immediately at whatever price is available."),
            ("Rohit buys 50 shares at ₹100 and pays ₹20 brokerage plus ₹15 charges. His total cost is:",
             ["₹5,000", "₹5,035", "₹5,050", "₹5,135"], 1,
             "Shares 50 x 100 = ₹5,000, plus 20 + 15 friction = ₹5,035."),
            ("He later sells those 50 shares at ₹118 with ₹35 in charges. His profit is:",
             ["₹900", "₹865", "₹830", "₹1,000"], 2,
             "Net sale = 5,900 - 35 = 5,865. Profit = 5,865 - 5,035 = ₹830 (a 16.5% return on ₹5,035)."),
            ("The Nifty rises from 22,000 to 22,220. In percent terms it rose:",
             ["220%", "10%", "1%", "0.1%"], 2,
             "220 / 22,000 x 100 = 1%. Always translate points into percent."),
            ("The Sensex and Nifty are best described as:",
             ["Guarantees of next week's prices", "Scoreboards tracking baskets of large companies", "Bank accounts for shares", "Government savings schemes"], 1,
             "They summarize how baskets of large companies moved on average: thermometers, not predictions."),
        ],
    },
    {
        "order": 4,
        "title": "Being the Bank: Deposits and Bonds",
        "youtube_url": "https://youtu.be/TTI2H_wLnaU",
        "summary": material("SCALE-C2-L04-Summary-9317831f.pdf"),
        "ppt": material("SCALE-C2-L04-Ppt-f32d345b.pdf"),
        # Eleven questions in this lesson, not ten like the earlier three.
        "quiz": [
            ("When you open a fixed deposit, you are:",
             ["Buying a share of the bank", "Lending money to the bank", "Insuring the bank", "Renting a locker"], 1,
             "A deposit is a loan from you to the bank. The interest is the price of that loan."),
            ("A bank pays 6% on deposits and lends at 9% (hypothetical). Its business runs on:",
             ["The 9% alone", "The 3% spread", "Government subsidy", "Locker fees"], 1,
             "The spread between lending and deposit rates is the engine of banking."),
            ("₹1,00,000 at 7% compounded annually for 3 years matures at about:",
             ["₹1,21,000", "₹1,22,504", "₹1,07,000", "₹1,31,080"], 1,
             "1,00,000 x 1.07^3 = ₹1,22,504. Quarterly compounding would give slightly more, about ₹1,23,144."),
            ("DICGC deposit insurance currently covers:",
             ["Unlimited amounts", "₹5 lakh per depositor per bank", "₹1 lakh per account", "Only fixed deposits above ₹10 lakh"], 1,
             "All same-bank accounts in the same right and capacity are aggregated, principal plus interest, under the cap, which can be revised."),
            ("Your savings are ₹12 lakh, all in one bank. The insurance-smart move is:",
             ["Keep it; banks cannot fail", "Spread it across multiple banks with headroom under each cap", "Move it to an NBFC deposit", "Convert it to cash at home"], 1,
             "The cap applies per bank and counts interest too, so spread banks and leave headroom. NBFC deposits are not DICGC-insured."),
            ("Your ₹10,000 bond pays ₹800 a year with 4 years left. New bonds of similar risk now yield 9%. Your bond's price is about:",
             ["₹10,000", "₹9,676", "₹8,000", "₹11,111"], 1,
             "Price = present value of the 4 remaining coupons plus the principal, discounted at 9%: about ₹9,676."),
            ("When market interest rates rise, existing lower-coupon bonds:",
             ["Rise in price", "Fall in price", "Are unaffected", "Are cancelled"], 1,
             "The seesaw: older bonds must cheapen until their coupon matches the new yield."),
            ("A company's bond yields 11% while an Indian government bond of similar maturity yields about 7%. The 4% gap most likely means:",
             ["A generous company", "The market pricing higher credit risk", "A printing error", "A government guarantee"], 1,
             "Compared like-for-like, a yield gap over the government bond prices the extra risk of default, not kindness."),
            ("If a bond's borrower defaults, investors may face:",
             ["Immediate full repayment", "Delayed, reduced or lost payments", "Automatic government refund", "A free replacement bond"], 1,
             "A bond is only as strong as the borrower. Default means the schedule breaks."),
            ("Laddering deposits means:",
             ["Stacking passbooks", "Staggering maturities so money regularly comes due", "Always choosing the longest term", "Borrowing against deposits"], 1,
             "Staggered maturities give regular access and let you reinvest at then-current rates."),
            ("The return that truly matters for a deposit is the:",
             ["Advertised rate", "Real, after-tax return", "Nominal rate plus bonus", "Neighbour's rate"], 1,
             "Tax and inflation decide what you actually keep and what it buys."),
        ],
    },
    {
        "order": 5,
        "title": "Owning Things: Shares, Gold, Real Estate",
        "youtube_url": "https://youtu.be/eK4RVNvYs80",
        "summary": material("SCALE-C2-L05-Summary-ac1c2567.pdf"),
        "ppt": material("SCALE-C2-L05-Ppt-e0def884.pdf"),
        "quiz": [
            ("Gold's return comes entirely from:",
             ["Interest it pays", "Rent it earns", "The change in its price", "Dividends"], 2,
             "Gold produces no cash flow. Only engine two, the price, moves your return."),
            ("A share bought at ₹200 pays ₹4 a year in dividends and is sold at ₹260 after 3 years. The total return is:",
             ["30%", "36%", "26%", "42%"], 1,
             "(260 + 12) / 200 - 1 = 36% over 3 years. IRR with dividends timed is about 11%."),
            ("You buy 10g of gold at ₹6,000/g with 12% making charges. Gold rises 25% and you sell at melt value. Your return is about:",
             ["25%", "11.6%", "37%", "0%"], 1,
             "Cost 67,200, received 75,000: 11.6%, in a model simplified before GST and spreads. The charges consumed most of the price rise."),
            ("The surest sign jewellery is an adornment first and an investment second is:",
             ["Its design", "Making charges you never recover", "Its weight", "The shop's location"], 1,
             "Making charges are lost at purchase. Investors minimize them by choosing coins, bars or regulated funds."),
            ("Checking a BIS hallmark tells you about gold's:",
             ["Future price", "Purity", "Weight in carats of gems", "Seller's honesty"], 1,
             "The BIS hallmark is the official purity certification."),
            ("Which is true of real estate compared with liquid shares?",
             ["Smaller ticket size", "Faster exit", "Entry costs of several percent and slow exits", "No ongoing costs"], 2,
             "Property demands several percent to enter, months to exit, and maintenance, tax and vacancy along the way. Liquid shares can sell fast on market days, though spreads and closures still apply."),
            ("A ₹60 lakh flat with 7% entry costs and ₹15,000 monthly rent has a rental yield on the all-in cost of about:",
             ["2.8%", "7%", "9%", "15%"], 0,
             "1.8 lakh a year on 64.2 lakh all-in is about 2.8%, in a model gross of operating costs."),
            ("Buying a home with a large home loan adds leverage, which means:",
             ["Only gains get bigger", "Only losses get bigger", "Gains and losses both grow relative to your own money", "The loan becomes free"], 2,
             "Leverage magnifies outcomes both ways against your own contribution."),
            ("For a new project, basic hygiene before buying includes checking:",
             ["The builder's RERA registration", "The neighbour's car", "The paint brand", "The broker's watch"], 0,
             "State RERA registration is the regulator's check on new projects."),
            ("Sovereign gold bonds are best described as:",
             ["A guaranteed yearly government scheme always open", "Government securities linked to the gold price, with a small fixed interest, under their own terms", "A type of jewellery", "A bank locker plan"], 1,
             "They are government securities that follow the gold price and pay a small fixed interest, with terms set for each series."),
            ("Why do families hold shares, gold and property together?",
             ["Tradition demands it", "Their bad years tend to arrive on different schedules, which can help", "It avoids all losses", "Tax becomes zero"], 1,
             "Diversifying across asset types can smooth the ride. It reduces, never eliminates, loss."),
        ],
    },
    {
        "order": 6,
        "title": "Mutual Funds and the Quiet Power of SIPs",
        "youtube_url": "https://youtu.be/95ofGrXxTsU",
        "summary": material("SCALE-C2-L06-Summary-efe16bef.pdf"),
        "ppt": material("SCALE-C2-L06-Ppt-8652dbf9.pdf"),
        "quiz": [
            ("A fund holds ₹200 crore of investments and has 8 crore units. Its NAV is:",
             ["₹25", "₹40", "₹208", "₹16"], 0,
             "NAV = 200 / 8 = ₹25 per unit."),
            ("Diversification protects best against:",
             ["Market-wide falls", "Single-company disasters", "Inflation", "High fees"], 1,
             "It shrinks single-company risk by the number of slices. Market falls still hit every slice."),
            ("One company in a 50-stock equal-weighted fund goes to zero. The fund loses about:",
             ["50%", "2%", "20%", "Nothing"], 1,
             "100% / 50 slices = 2%. Concentrated holders lost everything."),
            ("An index fund's main advantage is:",
             ["A famous manager", "Very low cost and no manager opinions", "Guaranteed returns", "Daily trading thrills"], 1,
             "It tracks the index cheaply with minimal discretion. The SPIVA India Mid-Year 2026 Scorecard found over 70% of active funds underperforming in every reported category over 10 years (large-cap 74%, ELSS 80%, mid/small-cap 82%)."),
            ("Two funds both earn 10% before fees. Fund A charges 0.2%, Fund B charges 1%. Over 20 years the fee gap on ₹1 lakh costs about:",
             ["₹800", "₹8,000", "₹89,000", "Nothing"], 2,
             "6.49 lakh vs 5.60 lakh, about ₹89,000: fees compound in reverse."),
            ("You SIP ₹5,000 at NAVs 50, then 25, then 50. Units bought:",
             ["300", "400", "100", "200"], 1,
             "100 + 200 + 100 = 400 units. Worth 20,000 at the final NAV of 50."),
            ("Rupee-cost averaging shines when markets:",
             ["Rise straight up", "Fall and then recover", "Stay perfectly flat", "Are closed"], 1,
             "Buying more units when cheap pays off when prices recover. In straight-up markets a lump sum wins."),
            ("A seller promises a market-linked fund with guaranteed 15% yearly returns. You should:",
             ["Invest quickly", "Invest a small test amount", "Walk away", "Ask for a brochure"], 2,
             "Guaranteed returns on market-linked products are a red flag, not an opportunity."),
            ("Which belongs in a fund check before investing?",
             ["The ad's celebrity", "Expense ratio, holdings, consistency, manager tenure", "Last month's return only", "The app's colour scheme"], 1,
             "Fees, contents, consistency and stewardship matter. Trophies and ads do not."),
            ("The line 'mutual fund investments are subject to market risks' means:",
             ["Funds are scams", "Funds can fall with markets; read the documents", "Only stocks fall", "SIPs are guaranteed"], 1,
             "The disclaimer is the honest core: structure and regulation, not promises."),
        ],
    },
]


async def main() -> None:
    course = await db.courses.find_one({"slug": SLUG})
    if not course:
        course = {
            "id": str(uuid.uuid4()),
            "slug": SLUG,
            "title": "Investing & Financial Markets",
            "subtitle": "How investing works and how financial markets operate.",
            "description": (
                "A free SCALE course on investing and financial markets. Ten lessons, "
                "each with a video, slides, a written summary and a quiz."
            ),
            "published": True,
            "order": 2,
            "created_at": now_iso(),
        }
        await db.courses.insert_one(course)
        print(f"Created course {course['id']} ({course['slug']})")
    else:
        print(f"Course already exists: {course['id']} ({course['slug']})")

    course_id = course["id"]

    for spec in LESSONS:
        print(f"\nLesson {spec['order']}: {spec['title']}")
        existing = await db.lessons.find({"course_id": course_id}, {"_id": 0}).to_list(500)
        match = next((l for l in existing if l.get("order") == spec["order"]), None)

        # If a source PDF is not on disk (already uploaded on a prior run,
        # then cleaned out of ~/Downloads), keep whatever file_refs id is
        # already on the lesson instead of overwriting it with None —
        # otherwise re-running this script silently breaks working PDF links.
        summary_path = spec.get("summary")
        if summary_path and summary_path.exists():
            summary_id = await upload_material(summary_path)
        else:
            summary_id = match.get("summary_pdf_id") if match else None

        ppt_path = spec.get("ppt")
        if ppt_path and ppt_path.exists():
            ppt_id = await upload_material(ppt_path)
        else:
            ppt_id = match.get("ppt_pdf_id") if match else None

        quiz = [
            {
                "id": str(uuid.uuid4()),
                "question": q,
                "options": opts,
                "correct_index": correct,
                "explanation": expl,
            }
            for (q, opts, correct, expl) in spec["quiz"]
        ]

        doc = {
            "course_id": course_id,
            "order": spec["order"],
            "title": spec["title"],
            "youtube_url": spec.get("youtube_url"),
            "summary_pdf_id": summary_id,
            "ppt_pdf_id": ppt_id,
            "quiz": quiz,
            "passing_pct": 60,
        }

        if match:
            doc["id"] = match["id"]
            await db.lessons.update_one({"id": match["id"]}, {"$set": doc})
            print(f"  updated lesson {match['id']}")
        else:
            doc["id"] = str(uuid.uuid4())
            doc["created_at"] = now_iso()
            await db.lessons.insert_one(doc)
            print(f"  created lesson {doc['id']}")

    # Progress report, so it is obvious how much of the course still has to
    # be built before the "all 10 lessons" certificate makes sense.
    all_lessons = await db.lessons.find({"course_id": course_id}, {"_id": 0}).to_list(500)
    done = len(all_lessons)
    print(f"\n{done} of {TOTAL_LESSONS} lessons exist for {SLUG}.")
    if done < TOTAL_LESSONS:
        missing = [n for n in range(1, TOTAL_LESSONS + 1)
                   if not any(l.get("order") == n for l in all_lessons)]
        print(f"Still to add: lesson(s) {', '.join(str(m) for m in missing)}")

    await db.close()


if __name__ == "__main__":
    asyncio.run(main())
